# Spec — Synchronisation temps réel multi-bénévoles

> Cadrage produit par les équipes **backend**, **sécurité/RGPD** et **data-db**.
> Objectif : passer l'app Maraude d'un stockage 100 % local à une synchro
> multi-bénévoles avec comptes, **sans perdre le fonctionnement hors-ligne**.

## 1. Architecture retenue

**Modèle offline-first « oplog » (pas de CRDT complet — surdimensionné pour une asso).**

- Chaque modification locale → un événement `{op, collection, id, patch, ts, deviceId, benevole, rev}` mis dans une file `outbox` (**IndexedDB**, pas localStorage).
- Au retour réseau : *push* de l'outbox → *pull* des events `updatedAt > lastSync` (curseur).
- **Tombstones obligatoires** : jamais de suppression physique (`deleted:true`), sinon un effacement fait hors-ligne « ressuscite » à la resync — grave pour le droit à l'effacement.
- **Résolution de conflits : LWW par champ**, horloge **serveur** autoritaire (les téléphones sont désynchronisés la nuit), `deviceId` en tiebreaker.
- Cas particuliers :
  - **Stock (`qte`)** → deltas cumulatifs (`{op:"increment", by:-1}`), pas de valeur absolue (sinon décréments concurrents perdus).
  - **Signalement `statut`** → machine à états, on garde l'état le plus avancé (`ouvert < pris en charge < traité`).

**Techno recommandée : PocketBase self-hosted (UE)** — binaire unique, auth + realtime SSE intégrés, ~5 €/mois, données maîtrisées (RGPD-friendly).
*Alternative : Supabase* (Postgres + RLS + Realtime, free tier) si besoin de SQL avancé/scale — mais dépendance cloud, surface RGPD plus large.

## 2. Authentification & rôles

- **Magic link email + code d'invitation asso** (zéro mot de passe : rien à retenir/fuir ; OTP SMS écarté — coût + SIM-swap). Fallback OTP 6 chiffres par email.
- **3 rôles** :
  - **Coordinateur** : gère l'asso, invitations, révocations, planning, exports, voit tout.
  - **Bénévole** : ses comptes-rendus terrain, planning et maraudes de son asso ; peut clore un signalement mais pas le supprimer ; pas d'export global.
  - **Public (sans compte)** : formulaire de signalement anonyme uniquement, rate-limité + captcha léger.
- **Multi-tenant** : chaque donnée porte un `orgId` **dérivé de la session serveur** (jamais d'un paramètre client → sinon fuite inter-asso).
- **Offline + révocation** : JWT court (15 min) + refresh token **révocable** (IndexedDB) lié à `membership.status`. Révoquer un bénévole = `status=revoked` → au prochain sync, token rejeté + purge locale. Ne jamais miser sur des JWT longs non révocables.

## 3. Contrat d'API

- `GET /sync?since=<cursor>&limit=200&types=...` → pull des deltas.
- `POST /sync/batch` → push (idempotent par `id`+`rev`), réponse = seq attribués + conflits.
- `GET /sync/snapshot` → bootstrap première install.
- `GET /sync/stream?since=<cursor>` → **SSE** temps réel (EventSource, auto-reconnect via `Last-Event-ID`).
- Curseur = compteur monotone `seq` par organisation. Tombstones conservés 90 j serveur.
- Droits appliqués côté serveur : mutations `maraudes/planned` et `delete` signalement → coordinateur (403 sinon).

## 4. Schéma de données (PostgreSQL / adaptable PocketBase)

Isolation par `org_id` sur chaque table, **RLS** (`USING (org_id = current_setting('app.org_id'))`).
Tables : `organisations`, `users`, `memberships(role)`, `maraudes`, `maraude_benevoles`, `subjects`, `rencontres`, `stock`, `signalements`, `ressources`.

Colonnes de synchro communes : `org_id, version, updated_at, deleted, created_by, device_id`
+ index composite `(org_id, updated_at)` pour le pull incrémental.

**Pseudonymisation** : l'identité des personnes rencontrées est **isolée** dans une table `subjects` (`prenom_enc` chiffré) ; `rencontres` ne porte qu'un `subject_id`. Purge RGPD = effacer `subjects` sans casser les stats.

## 5. RGPD — bloquant avant toute synchro de vraies données

- **Base légale** : mission d'intérêt public (art. 6-1-e) ou intérêt légitime — **pas** le consentement de la personne à la rue (non « libre »).
- **Données de santé** (besoin « Médical », `notes` libres) = art. 9 → exception nécessaire, sinon **ne pas synchroniser ce champ** (garder local/agrégé). Santé nominative synchronisée ⇒ hébergeur **HDS** obligatoire.
- **AIPD/DPIA + registre art. 30 : obligatoires** (santé + personnes vulnérables + géoloc = critères CNIL réunis).
- Minimisation (prénom optionnel, GPS arrondi), chiffrement TLS + au repos, hébergement UE, conservation limitée + purge auto, notice d'information affichable + procédure d'effacement par ID.

## 6. Actions priorisées

### P0 — bloquant (avant de synchroniser la moindre donnée réelle)
1. **AIPD/DPIA + registre art. 30** rédigés.
2. Trancher la base légale santé → sinon **exclure/anonymiser** « Médical » et `notes` de `SYNC_KEYS` (`app.js`).
3. **Hébergement UE** + TLS + chiffrement au repos + **pseudonymisation** (table `subjects`).
4. **Tombstones** + effacement par ID de rencontre (droit à l'effacement).
5. **Isolation multi-tenant** stricte (`org_id` dérivé de la session, RLS activée).

### P1 — socle fonctionnel
- Choix techno définitif (PocketBase vs Supabase).
- Auth magic link + invitations + 3 rôles + refresh révocable.
- Couche sync client : outbox IndexedDB, curseur persistant, wrapper autour de `DB.set` (ajouter `rev/updatedAt/deleted` aux entités).
- Stock en deltas, signalement en machine à états.
- Politique de conservation + purge automatique.

### P2 — confort / robustesse
- SSE temps réel (push des signalements urgents).
- Journal de conflits + audit.
- Dédoublonnage idempotent avancé (`UNIQUE(org_id, device_id, client_uuid)`).

## 7. Risques majeurs
1. **Fuite de données sensibles** (personnes vulnérables) — mitigé par P0-3/5.
2. **Effacement non propagé** (tombstones manquants) — mitigé par P0-4.
3. **Dérive d'horloge nocturne** faussant le LWW — horloge serveur autoritaire.
4. **Santé art. 9** synchronisée sans base légale/HDS — mitigé par P0-2.
