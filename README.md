# Michael Jackson Top 15

Application web pour classer les 15 meilleures chansons de Michael Jackson, avec:

- catalogue local de chansons de Michael Jackson
- interface glisser-deposer sur desktop et edition fluide sur mobile
- enregistrement des votes dans Postgres sur Render
- calcul d'un classement consolide via decompte de Borda

## Prerequis

- Node.js 24+

## Configuration

Recopiez `.env.example` vers `.env` si vous voulez personnaliser:

- `PORT`
- `DB_PATH`
- `DATABASE_URL`

## Lancement

Lancez simplement:

```bash
node server.js
```

Ouvrez ensuite [http://localhost:3000](http://localhost:3000).

## Base de donnees

Le projet utilise:

- Postgres si `DATABASE_URL` est renseigne
- SQLite locale sinon, pour le developpement local

Comportement:

- en local sans Postgres: `data/app.db`
- en production Render recommande: `DATABASE_URL`
- migration automatique depuis `data/votes.json` si ce fichier existe encore et si la base cible est vide

## Catalogue local

Le catalogue embarque [data/michael-jackson-catalog.json](/Users/jhaddad/Documents/Codex/2026-04-22-je-veux-cr-er-un-site/data/michael-jackson-catalog.json) avec 133 titres.

Portee actuelle:

- chansons officiellement publiees sous le nom de Michael Jackson
- albums studio et grands albums originaux majeurs
- titres dedupliques
- remixes exclus

Si besoin, on peut etendre ensuite le catalogue aux raretes, demos, faces B et titres hors album.

## Methode Borda

Chaque vote doit contenir exactement 15 chansons:

- rang 1 = 15 points
- rang 2 = 14 points
- ...
- rang 15 = 1 point

Le classement consolide trie ensuite les morceaux par total de points.

## Deploiement

Le projet contient:

- [Dockerfile](/Users/jhaddad/Documents/Codex/2026-04-22-je-veux-cr-er-un-site/Dockerfile)
- [render.yaml](/Users/jhaddad/Documents/Codex/2026-04-22-je-veux-cr-er-un-site/render.yaml)

Configuration Render recommandee:

- runtime Docker
- variable `DATABASE_URL` pointant vers votre base Render Postgres

L'endpoint de sante est `/api/health`.

## Publication GitHub puis Render

Depuis le dossier du projet:

```bash
git config user.name "Votre Nom"
git config user.email "vous@example.com"
git status
git commit -m "Initial deploy-ready version"
git remote add origin <URL_DU_REPO_GITHUB>
git push -u origin main
```

Puis dans Render:

1. Creez un nouveau `Web Service` depuis votre repo GitHub.
2. Laissez Render detecter [render.yaml](/Users/jhaddad/Documents/Codex/2026-04-22-je-veux-cr-er-un-site/render.yaml).
3. Creez une base Render Postgres dans la meme region que le web service.
4. Recopiez son URL interne dans `DATABASE_URL`.
5. Deployez puis ouvrez `/api/health` pour verifier que `storage` vaut `postgres`.
