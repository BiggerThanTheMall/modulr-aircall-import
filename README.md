# Modulr Aircall Import

Projet indépendant pour importer un appel Aircall depuis une fiche client Modulr et créer une note normalisée dans Modulr.

## Workflow

1. Ouvrir une fiche client Modulr.
2. Cliquer sur `Récupérer un appel Aircall`.
3. Le userscript relève les numéros visibles sur la fiche.
4. Le backend recherche les appels Aircall récents correspondant à ces numéros via `raw_digits`.
5. S'il y a plusieurs appels, l'utilisateur choisit le bon.
6. Le backend fournit les métadonnées Aircall et les données IA disponibles.
7. Le userscript crée une note Modulr via `TasksManage.php` avec `event_type=195`.

## Format de note

`Contact téléphonique (JJ/MM/AAAA) - Collaborateur`

Contenu structuré : date/heure, sens entrant/sortant, numéro, durée, résumé, qualité/score, sentiment, sujets et actions à entreprendre.

## Sécurité

Les identifiants Aircall ne doivent jamais être placés dans le userscript. Ils restent côté serveur dans les variables d'environnement.

## Fichiers

- `modulr-aircall-import.user.js` : bouton Modulr, choix de l'appel et création de la note.
- `server.js` : bridge sécurisé vers Aircall.
- `.env.example` : variables nécessaires.
- `package.json` : dépendances Node.js.

## Données Aircall

Le rapprochement utilise `raw_digits`, recommandé par Aircall comme clé de recherche du correspondant externe. Les événements Conversation Intelligence (`summary.created`, `topics.created`, `action_item.created`, etc.) peuvent alimenter le backend. Les évaluations QA sont récupérables avec `GET /v1/calls/:call_id/evaluations`.
