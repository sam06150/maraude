# 📋 Dossier RGPD — Maraude

Ces documents sont les **livrables P0** à finaliser **avant** de synchroniser des
données réelles de personnes. Ce sont des brouillons prêts à compléter (`[À COMPLÉTER]`)
et à faire valider par le responsable de l'association et, idéalement, un DPO ou juriste.

| Document | Rôle | Statut |
|---|---|---|
| [AIPD.md](AIPD.md) | Analyse d'impact (art. 35) — **obligatoire** ici | Brouillon à compléter |
| [registre-traitements.md](registre-traitements.md) | Registre des traitements (art. 30) — **obligatoire** | Brouillon à compléter |
| [notice-information.md](notice-information.md) | Notices d'information (art. 13/14) : affichette + version longue | Brouillon à compléter |

## Checklist P0 avant synchro de vraies données

- [ ] AIPD complétée, risques évalués, validée par le responsable
- [ ] Registre art. 30 rempli (durées de conservation décidées)
- [ ] Notices d'information imprimées / affichées / intégrées à l'app
- [ ] Base légale « santé » tranchée → **champ Médical + notes exclus de la synchro** (fait côté code : voir `SYNC_EXCLURE_SANTE` dans `sync.js`)
- [ ] Hébergement UE choisi + chiffrement au repos + TLS
- [ ] Procédure de sauvegarde/restauration testée
- [ ] Procédure d'exercice des droits (accès/effacement par ID) documentée

> ⚠️ Ces brouillons ne valent pas conseil juridique. Faites-les relire avant mise en production.
