# 🤝 Maraude — outil de terrain solidaire

Application web (PWA) pour aider les maraudes : coordonner les tournées, suivre les
rencontres, gérer les stocks embarqués, recevoir des signalements citoyens et
trouver les ressources d'aide à proximité.

**Fonctionne sur mobile (bénévoles terrain) et sur ordinateur (coordination).**
Aucune installation serveur, aucune donnée envoyée en ligne : tout est stocké
localement sur l'appareil (`localStorage`).

## Les 5 modules

| Module | Pour qui | Ce qu'il fait |
|---|---|---|
| 🧭 **Terrain** | Bénévoles | Démarrer une maraude, poser des rencontres sur la carte, noter besoins / orientation |
| 📦 **Stock** | Bénévoles | Inventaire embarqué, **tailles**, **partenaire/donateur**, **journal des dons daté** (récap du mois), **édition** des articles, +/− en un tap, alertes de stock bas |
| 📅 **Coordination** | Coordinateurs | Statistiques, planning, **agenda & rappels**, **rapport d'activité PDF**, besoins fréquents, export CSV |
| 🌍 **Carte globale** | Tous | Personnes, rencontres et signalements sur une seule carte, filtrable, avec vue **densité** |
| 🧑 **Personnes** | Bénévoles | Fiches des personnes à la rue : nom, âge, animaux, lieu habituel, + articles, démarches et cagnotte |
| 🚨 **Signalements** | Grand public | Signaler une personne en difficulté, géolocalisation, suivi de statut |
| 🗺️ **Ressources** | Tous | Annuaire géolocalisé : douches, repas, hébergement, santé… |
| 👥 **Admin / Personnel** | Coordinateurs | Gérer l'équipe : ajouter, modifier, marquer indisponible, supprimer |

### Fiche « Personne à la rue » (onglets)

- **Infos** : nom/surnom, âge, animaux, **téléphone, email** (cliquables), **réseaux sociaux** (TikTok, Insta… + pseudo, liens cliquables), **adresse où elle dort / où la trouver**, repère, notes.
- **Adresse automatique** : bouton « 📍 Localiser automatiquement » → récupère le GPS puis le convertit en adresse lisible (OpenStreetMap / Nominatim) et remplit adresse + coordonnées tout seul. Dégrade proprement hors-ligne (garde les coordonnées).
- **Carte** : la vue Personnes affiche une carte des lieux habituels ; un clic sur un marqueur ouvre la fiche.
- **Lien Terrain ↔ Personnes** : depuis une rencontre, on peut **rattacher** la personne à une fiche existante ou **créer une nouvelle fiche** préremplie (nom/lieu/GPS) et automatiquement liée.
- **Historique** : la fiche liste toutes les rencontres rattachées à la personne (date, lieu, bénévole, besoins), de la plus récente à la plus ancienne.
- **Recherche & filtres** : la vue Personnes offre une recherche (nom, lieu, adresse) et des filtres rapides — articles à fournir, démarches en cours, cagnotte active, **pas vu·e récemment** — qui mettent aussi à jour la carte.
- **Statistiques par personne** : nombre de rencontres, date du dernier contact, et **alerte « pas vu·e depuis X jours »** (seuil 14 j) — visible sur la carte, dans la fiche et via le filtre dédié.
- **Situation** : statut à la rue / hébergé·e / sorti·e de rue (puce colorée sur la carte et la fiche).
- **Rappels de RDV** : chaque démarche peut avoir une **échéance** ; les fiches avec un RDV proche/en retard sont signalées (⏰) et filtrables.
- **Distribution liée au stock** : lors d'une rencontre, les articles donnés **décrémentent automatiquement le stock** et sont tracés dans l'historique de la personne (« qui a reçu quoi »).
- **QR codes** : QR partageable d'une **cagnotte**, et QR d'accès au **formulaire de signalement citoyen** (à afficher/imprimer).
- **Export / impression de la fiche** : bouton 🖨️ → génère une fiche imprimable (infos, articles, démarches, cagnotte, historique) que le navigateur peut **enregistrer en PDF** pour la transmettre à un partenaire social. Mention de confidentialité RGPD incluse.
- **Articles** : liste détaillée des besoins par personne, avec quantité, priorité (haute/moyenne/basse) et suivi « fourni ✅ ».
- **Démarches** : checklist pour sortir de la rue (domiciliation, papiers, SIAO/115, RSA, AME, compte bancaire…), statut À faire → En cours → Fait.
- **Cagnotte** : objectif, montant collecté, barre de progression et **lien vers une cagnotte en ligne**. Pour collecter réellement, créer la cagnotte sur une plateforme (ex. **HelloAsso**, sans frais pour les assos) et coller le lien.

## Nouveautés (les 4 évolutions)

1. **⚙️ Réglages + identité bénévole** — chaque rencontre est signée du prénom du bénévole ; accessibilité renforcée (langue, focus, touche Échap, libellés ARIA).
2. **🔄 Regroupement entre bénévoles** — chaque bénévole exporte son `.json` (nommé à son prénom, contenant **toutes** les collections : rencontres, personnes, stock, dons, signalements, équipe…). Le coordinateur les **importe tous d'un coup** (sélection multiple) : **fusion LWW** — le plus récent gagne, rien n'est écrasé par erreur. *(La synchro temps réel multi-appareils nécessitera un serveur — V2.)*
3. **❄️ Mode Grand Froid** — bandeau d'alerte, besoins prioritaires pré-cochés (couverture, boisson chaude, 115), et **mobilisation express** avec message d'appel prêt à copier.
4. **⬇ Import de l'annuaire** — bouton *Importer* dans Ressources : accepte un fichier **JSON** (tableau) ou **CSV** (`nom,type,adresse,horaires,tel,lat,lng`), compatible avec un export Soliguide / open data.

## Lancer l'app

**Option simple :** double-cliquer sur `index.html`.
La carte a besoin d'internet la première fois ; le reste marche même hors-ligne.

**Option recommandée (pour le mode hors-ligne complet / installation mobile)** —
servir via un petit serveur local, car le service worker exige `http://` :

```bash
# Python (déjà installé sur la plupart des machines)
python -m http.server 8000
# puis ouvrir http://localhost:8000
```

Sur mobile : ouvrir l'URL dans Chrome/Safari → menu → **« Ajouter à l'écran d'accueil »**.
L'app s'installe comme une vraie appli.

## 📤 Mettre en ligne & partager (QR code)

Le bouton **📤** (barre latérale) ouvre un **QR code + lien** que les bénévoles scannent
pour installer l'app. ⚠️ **Le QR encode l'adresse à laquelle le site est servi.** Un
`localhost` ne marche que sur ton PC — pour un accès **sur le terrain, il faut d'abord
mettre le site en ligne** à une adresse publique.

**Le plus rapide (ce soir, sans compte) — Netlify Drop :**
1. Aller sur <https://app.netlify.com/drop>.
2. **Glisser-déposer le dossier `Maraude`** entier dans la page.
3. En quelques secondes tu obtiens une URL publique HTTPS (ex. `https://maraude-xyz.netlify.app`).
4. Ouvre cette URL, clique **📤**, et **montre/imprime le QR** pour les bénévoles.

> 💡 Le lien Netlify Drop est éphémère/anonyme. Pour un lien stable, crée un compte
> gratuit (Netlify, Cloudflare Pages ou GitHub Pages) et redéploie le dossier.

**Sur le même Wi-Fi seulement** (dépannage, pas pour la rue) : lance
`python -m http.server 8000`, trouve l'IP locale de ton PC (`ipconfig`), et partage
`http://TON_IP:8000`. Ne fonctionne que tant que ton PC reste allumé et sur le réseau.

> 🔒 Rappel : chaque URL a **son propre stockage** (voir « Persistance »). Chaque bénévole
> saisit sur son appareil ; regroupe via l'**export/import** ou la synchro serveur.

## Personnaliser

- **Ressources / secteurs / besoins de départ :** éditer `data.js`.
- **Couleurs et thème :** variables CSS en haut de `styles.css`.
- **Ville par défaut de la carte :** coordonnées dans `initMap(...)` (`app.js`).

## 🔄 Synchronisation multi-bénévoles (P1)

Une couche de synchro offline-first est en place (`sync.js`) — réglable dans **⚙️ Réglages → Synchronisation** :

- **Désactivée** (défaut) : 100 % local, comme avant.
- **Démo** : un serveur simulé en mémoire pour **tester la synchro sans backend**. Boutons « Simuler un autre bénévole » et « Réinitialiser le cloud démo ».
- **Serveur** : pointe vers un backend REST type PocketBase (cf. [docs/SPEC-synchro.md](docs/SPEC-synchro.md)).

Mécanique : horodatage + version par enregistrement, fusion **LWW**, **tombstones** (les suppressions se propagent), file d'attente, indicateur d'état dans la barre latérale.

> 🔒 **Exclusion RGPD automatique** : le champ « Médical » et les notes libres ne sont **jamais** envoyés au serveur (gardés en local uniquement). Voir `SYNC_EXCLURE_SANTE` dans `sync.js`.

⚠️ **Avant de synchroniser de vraies données de personnes**, traiter les livrables du dossier [docs/rgpd/](docs/rgpd/) (AIPD, registre, notices) — c'est un prérequis légal, pas une option.

### Verrouillage & rétention (⚙️ Réglages → Sécurité)

- **Code PIN à l'ouverture** : protège l'accès à l'app (données de personnes vulnérables). *Protection de niveau appareil — un vrai chiffrement viendra avec le backend.*
- **Purge automatique** : suppression des rencontres et signalements de plus de 3 / 6 / 12 mois, appliquée au démarrage (minimisation RGPD).

## 💾 Persistance & sauvegarde

**Tes données ne se perdent pas lors des mises à jour.** Elles sont stockées dans le
navigateur (`localStorage`), qui **survit aux rechargements et aux mises à jour du code** —
le code applicatif et les données sont indépendants. Les données de départ (stock, ressources)
ne sont créées que si elles n'existent pas encore : une mise à jour **n'écrase jamais** ce que tu as saisi.

En plus :
- **Migration de données** : un numéro de version (`_dataVersion`) permet d'adapter les futures
  évolutions du modèle **sans perdre** l'existant.
- **Sauvegarde automatique locale** : une copie complète est enregistrée en tâche de fond après
  chaque modification. Depuis ⚙️ Réglages → Sécurité, tu peux **restaurer la dernière sauvegarde** en un clic.
- **Sauvegarde manuelle** : export/import d'un fichier `.json` (⚙️ Réglages → Synchronisation) pour
  transférer entre appareils ou garder une copie hors de l'appareil.

> ℹ️ Le stockage est **par origine** (adresse du site). Si tu ouvres l'app depuis une autre URL
> (ex. `file://` vs `localhost` vs un site déployé), c'est un espace de stockage différent :
> utilise l'export/import pour transférer tes données.

## ⚠️ Données personnelles (RGPD)

Ce module gère potentiellement des données sensibles (personnes en précarité).
Version actuelle = **stockage local uniquement**, volontairement, pour éviter tout
risque. Avant tout partage multi-appareils / cloud, prévoir :
- minimisation (ne saisir que le nécessaire, anonymat par défaut),
- consentement, durée de conservation, droit à l'effacement,
- chiffrement et hébergement conforme.

## Prochaines étapes possibles (V2)

- Synchronisation multi-bénévoles (backend + auth)
- Comptes association / rôles (coordinateur, bénévole)
- Notifications de signalement en temps réel
- Import de l'annuaire Soliguide / open data local
- Mode « grand froid » (plan hiver, itinéraires prioritaires)
