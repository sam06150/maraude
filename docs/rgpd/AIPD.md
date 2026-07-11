# AIPD — Application « Maraude » (synchro backend multi-bénévoles)

> Brouillon d'analyse d'impact relative à la protection des données (art. 35 RGPD),
> à compléter et valider par l'association avant toute mise en production de la synchro.

**Responsable de traitement :** [À COMPLÉTER : nom de l'association, SIRET, adresse]
**DPO / référent RGPD :** [À COMPLÉTER : nom, email]
**Date / version :** [À COMPLÉTER] — v0.1 (brouillon)

## 1. Description du traitement

**Finalités**
- Coordination des tournées d'aide aux personnes sans-abri (rencontres, besoins, orientation).
- Traitement des signalements citoyens géolocalisés.
- Gestion des comptes bénévoles et du stock matériel.

**Données traitées**

| Catégorie | Données | Sensibilité |
|---|---|---|
| Rencontres | Prénom (optionnel), position GPS, besoins, notes libres, orientation | Personnes vulnérables + géoloc |
| Champ « Médical »/santé | Exclu de la synchro (anonymisé/local uniquement) | Art. 9 — hors périmètre backend |
| Signalements | Position GPS, description | Géoloc |
| Bénévoles | Email, nom | Identifiantes |
| Stock | Quantités matériel | Non personnelles |

**Personnes concernées :** personnes rencontrées (public vulnérable), citoyens signalants, bénévoles.

**Destinataires :** bénévoles habilités de l'association (accès par rôle/organisation) ; hébergeur PocketBase self-host (UE). Aucun transfert hors UE.
**Sous-traitants :** [À COMPLÉTER : hébergeur/datacenter, contrat art. 28].

**Durées de conservation :** rencontres/signalements [À COMPLÉTER, ex. 12 mois] ; comptes bénévoles [durée de l'engagement + X mois] ; sauvegardes [À COMPLÉTER].

## 2. Base légale et principes

**Base légale :** mission d'intérêt public (art. 6-1-e) — action sociale d'aide aux personnes sans-abri. [À COMPLÉTER : référence statuts/mandat associatif].
Le champ santé (art. 9) étant **exclu du backend**, aucune condition de levée d'interdiction art. 9 n'est requise pour la synchro.

- **Licéité :** finalités déterminées, explicites, légitimes.
- **Loyauté/transparence :** information des bénévoles ; affichette/mention pour signalants ; personnes rencontrées informées oralement quand possible [À COMPLÉTER : modalités].
- **Minimisation :** prénom optionnel, notes libres encadrées (consigne : pas de données santé/religion/etc.), santé non synchronisée.

## 3. Mesures de sécurité

- **Chiffrement :** TLS obligatoire (HTTPS) en transit ; chiffrement au repos du volume serveur [À COMPLÉTER : LUKS/chiffrement disque].
- **Pseudonymisation :** table `subjects` séparant identifiants directs des données de rencontre (référence par ID).
- **Contrôle d'accès :** authentification bénévole, autorisation par rôle et par organisation (règles PocketBase / API rules), principe du moindre privilège.
- **Sauvegardes :** chiffrées, testées, rétention définie, stockage UE [À COMPLÉTER : fréquence, localisation].
- **Journalisation :** logs d'accès/administration [À COMPLÉTER : rétention].
- **Comptes :** politique de mots de passe, révocation au départ d'un bénévole.

## 4. Analyse des risques

| Risque | Sources / menaces | Gravité | Vraisemblance | Mesures |
|---|---|---|---|---|
| **Accès illégitime** (fuite localisation d'une personne vulnérable) | Compte compromis, mauvaise config API rules | Élevée | Moyenne | RBAC par org, MFA [À COMPLÉTER], TLS, revue des règles, alertes |
| **Modification/perte** de données | Panne, suppression accidentelle, ransomware | Moyenne | Moyenne | Sauvegardes chiffrées testées, restauration documentée, moindre privilège |
| **Réidentification** (croisement GPS + notes) | Notes libres trop détaillées, agrégation | Élevée | Moyenne | Pseudonymisation `subjects`, consignes de saisie, minimisation, durée courte, arrondi GPS [À COMPLÉTER] |
| **Accès non autorisé bénévole** | Excès de permissions | Moyenne | Faible | Cloisonnement par organisation, journalisation |

Risque résiduel jugé : [À COMPLÉTER : acceptable / à réduire].

## 5. Plan d'action et avis

**Plan d'action**

| Action | Priorité | Responsable | Échéance |
|---|---|---|---|
| Durcir API rules par rôle/org + tests | P0 | [À COMPLÉTER] | [À COMPLÉTER] |
| MFA comptes bénévoles | P1 | [À COMPLÉTER] | [À COMPLÉTER] |
| Procédure sauvegarde/restauration testée | P0 | [À COMPLÉTER] | [À COMPLÉTER] |
| Consignes de saisie (notes/santé exclue) | P1 | [À COMPLÉTER] | [À COMPLÉTER] |
| Mentions d'information + registre art. 30 | P1 | [À COMPLÉTER] | [À COMPLÉTER] |

**Avis du DPO :** [À COMPLÉTER]
**Décision du responsable de traitement :** [À COMPLÉTER : validation / conditions]
**Date de révision prévue :** [À COMPLÉTER, ex. 12 mois ou évolution majeure].
