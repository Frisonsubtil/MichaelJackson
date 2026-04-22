# Michael Jackson Top 15

Application web pour classer les 15 meilleures chansons de Michael Jackson, avec:

- catalogue Spotify des morceaux de Michael Jackson
- interface glisser-deposer pour composer un Top 15
- enregistrement des votes dans une vraie base SQLite
- calcul d'un classement consolide via decompte de Borda

## Prerequis

- Node.js 24+
- des identifiants Spotify Web API

## Configuration Spotify

1. Creez une application sur le tableau de bord Spotify for Developers.
2. Recopiez `.env.example` vers `.env`.
3. Renseignez:

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `DB_PATH` si vous voulez un chemin different pour la base

## Lancement

Lancez simplement:

```bash
node server.js
```

Ouvrez ensuite [http://localhost:3000](http://localhost:3000).

## Base de donnees

Les votes sont stockes dans une base SQLite:

- locale par defaut: `data/app.db`
- configurable via `DB_PATH`
- migration automatique depuis `data/votes.json` si ce fichier existe encore

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
- disque persistant monte sur `/data`
- `DB_PATH=/data/app.db`
- variables `SPOTIFY_CLIENT_ID` et `SPOTIFY_CLIENT_SECRET`

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
3. Renseignez `SPOTIFY_CLIENT_ID` et `SPOTIFY_CLIENT_SECRET`.
4. Verifiez qu'un disque persistant est monte sur `/data`.
5. Deployez puis ouvrez `/api/health` pour verifier que tout est vert.
