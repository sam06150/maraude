# Registre des activités de traitement (art. 30 RGPD) — Association « Maraude »

**Responsable de traitement :** [À COMPLÉTER — nom asso, SIRET, adresse]
**Représentant légal :** [À COMPLÉTER — président·e]
**DPO / référent RGPD :** [À COMPLÉTER — nom, email, tél] (DPO non obligatoire si pas de suivi à grande échelle, mais recommandé)
**Date de création / dernière mise à jour :** [À COMPLÉTER] · **Version :** v1.0

---

## Traitement n°1 — Suivi des maraudes et des personnes rencontrées

| Colonne | Contenu |
|---|---|
| **Finalité** | Organiser les maraudes, assurer le suivi social des personnes rencontrées, coordonner l'aide (besoins, orientation), produire des statistiques anonymisées d'activité. |
| **Base légale** | Mission d'intérêt public / intérêt légitime de l'asso (art. 6.1.e ou 6.1.f). Consentement (art. 6.1.a) pour le prénom et les notes nominatives. Données de santé **exclues de la synchro** — non traitées dans le système. |
| **Catégories de personnes** | Personnes sans-abri / en situation de précarité rencontrées lors des maraudes. |
| **Catégories de données** | Localisation GPS de la rencontre, besoins exprimés, prénom (optionnel), notes de terrain. **Aucune donnée de santé synchronisée.** |
| **Destinataires** | Bénévoles habilités de l'asso, coordinateurs de maraude. [À COMPLÉTER — partenaires sociaux éventuels : 115, CCAS…]. Hébergeur : [À COMPLÉTER — nom, localisation UE]. |
| **Transferts hors UE** | Non. Hébergement et sous-traitants situés dans l'UE. [À COMPLÉTER si outil tiers] |
| **Durée de conservation** | Données de suivi : [À COMPLÉTER — ex. 12 mois] puis anonymisation. Statistiques anonymisées : illimité. |
| **Mesures de sécurité** | Chiffrement en transit (TLS) et au repos, authentification des bénévoles, habilitations par rôle, minimisation (prénom optionnel), exclusion des données de santé de la synchro, journalisation des accès, sauvegardes chiffrées. [À COMPLÉTER — MFA, politique mdp] |

---

## Traitement n°2 — Signalements citoyens de personnes en difficulté

| Colonne | Contenu |
|---|---|
| **Finalité** | Recueillir les signalements géolocalisés de personnes en difficulté transmis par des citoyens, pour orienter les maraudes. |
| **Base légale** | Intérêt légitime / mission d'intérêt public (art. 6.1.e/f). Consentement du citoyen signalant (art. 6.1.a) pour ses éventuelles coordonnées. |
| **Catégories de personnes** | Citoyens signalants (si identifiés) ; personnes signalées (tiers). |
| **Catégories de données** | Localisation GPS du signalement, description de la situation, éventuelles coordonnées du signalant (optionnelles). |
| **Destinataires** | Bénévoles / coordinateurs habilités. Hébergeur UE : [À COMPLÉTER]. |
| **Transferts hors UE** | Non. |
| **Durée de conservation** | Signalement : [À COMPLÉTER — ex. 3 mois] après traitement, puis suppression/anonymisation. |
| **Mesures de sécurité** | TLS, accès restreint aux bénévoles habilités, minimisation, purge automatique, journalisation. Information des personnes signalées : [À COMPLÉTER — modalités]. |

---

## Traitement n°3 (optionnel) — Gestion des comptes bénévoles

| Colonne | Contenu |
|---|---|
| **Finalité** | Créer et gérer les comptes des bénévoles, authentification, gestion des habilitations. |
| **Base légale** | Exécution d'un contrat / relation bénévole (art. 6.1.b) ; intérêt légitime (art. 6.1.f). |
| **Catégories de personnes** | Bénévoles de l'association. |
| **Catégories de données** | Email, nom, mot de passe (haché), rôle/habilitations, logs de connexion. |
| **Destinataires** | Administrateurs de l'asso, hébergeur UE : [À COMPLÉTER]. |
| **Transferts hors UE** | Non. |
| **Durée de conservation** | Durée du bénévolat + [À COMPLÉTER — ex. 12 mois] après départ, puis suppression. |
| **Mesures de sécurité** | Mots de passe hachés (bcrypt/argon2), TLS, contrôle d'accès par rôle, [À COMPLÉTER — MFA], journalisation des connexions. |

---

**Points de vigilance :** confirmer l'exclusion effective des données de santé côté code/synchro ; définir les durées exactes ; prévoir mentions d'information (art. 13/14) ; réaliser l'AIPD (art. 35) vu la vulnérabilité du public.
