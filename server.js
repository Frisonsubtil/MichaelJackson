const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const LEGACY_VOTES_PATH = path.join(DATA_DIR, "votes.json");
const DEFAULT_DB_PATH = path.join(DATA_DIR, "app.db");
const CATALOG_PATH = path.join(DATA_DIR, "michael-jackson-catalog.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

let storage;
let catalogCache;

function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");

  return fs.readFile(envPath, "utf8")
    .then((content) => {
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const separatorIndex = trimmed.indexOf("=");
        if (separatorIndex <= 0) continue;

        const key = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
        if (!(key in process.env)) {
          process.env[key] = value;
        }
      }
    })
    .catch(() => {});
}

function getPort() {
  return Number(process.env.PORT || 3000);
}

function getDatabasePath() {
  return process.env.DB_PATH || DEFAULT_DB_PATH;
}

function getDatabaseUrl() {
  return process.env.DATABASE_URL || "";
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function ensureDataDirectory() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const dbDirectory = path.dirname(getDatabasePath());
  await fs.mkdir(dbDirectory, { recursive: true });
}

async function readLegacyVotes() {
  try {
    const content = await fs.readFile(LEGACY_VOTES_PATH, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadCatalog() {
  if (catalogCache) {
    return catalogCache;
  }

  const content = await fs.readFile(CATALOG_PATH, "utf8");
  const parsed = JSON.parse(content);
  catalogCache = Array.isArray(parsed) ? parsed : [];
  return catalogCache;
}

function scoreVote(rankedTracks) {
  return rankedTracks.map((track, index) => ({
    ...track,
    rank: index + 1,
    bordaPoints: 15 - index,
  }));
}

function validateRankedTracks(rankedTracks) {
  if (!Array.isArray(rankedTracks) || rankedTracks.length !== 15) {
    return "Le vote doit contenir exactement 15 chansons.";
  }

  const ids = new Set();
  for (const track of rankedTracks) {
    if (!track || typeof track.id !== "string" || typeof track.name !== "string") {
      return "Chaque chanson doit contenir un id et un nom.";
    }

    if (ids.has(track.id)) {
      return "Le Top 15 ne peut pas contenir deux fois la meme chanson.";
    }

    ids.add(track.id);
  }

  return null;
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function createSqliteStorage() {
  await ensureDataDirectory();

  const db = new DatabaseSync(getDatabasePath());
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS votes (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vote_tracks (
      vote_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      name TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      image TEXT,
      spotify_url TEXT,
      rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 15),
      borda_points INTEGER NOT NULL CHECK(borda_points BETWEEN 1 AND 15),
      PRIMARY KEY (vote_id, rank),
      FOREIGN KEY (vote_id) REFERENCES votes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_vote_tracks_track_id ON vote_tracks(track_id);
    CREATE INDEX IF NOT EXISTS idx_vote_tracks_vote_id ON vote_tracks(vote_id);
  `);

  const countVotes = () => {
    const row = db.prepare("SELECT COUNT(*) AS total FROM votes").get();
    return Number(row.total || 0);
  };

  const insertVote = async (vote) => {
    const insertVoteStatement = db.prepare(`
      INSERT INTO votes (id, created_at)
      VALUES (?, ?)
    `);

    const insertTrackStatement = db.prepare(`
      INSERT INTO vote_tracks (
        vote_id,
        track_id,
        name,
        artist,
        album,
        image,
        spotify_url,
        rank,
        borda_points
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.exec("BEGIN");

    try {
      insertVoteStatement.run(vote.id, vote.createdAt);

      for (const track of vote.rankedTracks) {
        insertTrackStatement.run(
          vote.id,
          track.id,
          track.name,
          track.artist || "",
          track.album || "",
          track.image || null,
          track.spotifyUrl || null,
          track.rank,
          track.bordaPoints,
        );
      }

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  if (countVotes() === 0) {
    const legacyVotes = await readLegacyVotes();
    for (const vote of legacyVotes) {
      if (!vote?.id || !Array.isArray(vote.rankedTracks)) continue;
      await insertVote({
        id: vote.id,
        createdAt: vote.createdAt || new Date().toISOString(),
        rankedTracks: vote.rankedTracks,
      });
    }
  }

  return {
    kind: "sqlite",
    detail: getDatabasePath(),
    async getVoteCount() {
      return countVotes();
    },
    async insertVote(vote) {
      await insertVote(vote);
    },
    async getVoteById(voteId) {
      const voteRow = db.prepare(`
        SELECT id, created_at AS createdAt
        FROM votes
        WHERE id = ?
      `).get(voteId);

      if (!voteRow) {
        return null;
      }

      const rankedTracks = db.prepare(`
        SELECT
          track_id AS id,
          name,
          artist,
          album,
          image,
          spotify_url AS spotifyUrl,
          rank,
          borda_points AS bordaPoints
        FROM vote_tracks
        WHERE vote_id = ?
        ORDER BY rank ASC
      `).all(voteId);

      return {
        ...voteRow,
        rankedTracks,
      };
    },
    async getLeaderboard() {
      const totalVotesRow = db.prepare("SELECT COUNT(*) AS totalVotes FROM votes").get();
      const ranking = db.prepare(`
        SELECT
          track_id AS id,
          name,
          artist,
          album,
          image,
          spotify_url AS spotifyUrl,
          SUM(borda_points) AS totalPoints,
          COUNT(*) AS appearances,
          SUM(rank) AS rankSum,
          SUM(CASE WHEN rank = 1 THEN 1 ELSE 0 END) AS firstPlaceVotes,
          ROUND(AVG(rank), 2) AS averageRank
        FROM vote_tracks
        GROUP BY track_id, name, artist, album, image, spotify_url
        ORDER BY totalPoints DESC, firstPlaceVotes DESC, appearances DESC, name ASC
      `).all();

      return {
        totalVotes: Number(totalVotesRow.totalVotes || 0),
        ranking: ranking.map((row) => ({
          ...row,
          totalPoints: Number(row.totalPoints),
          appearances: Number(row.appearances),
          rankSum: Number(row.rankSum),
          firstPlaceVotes: Number(row.firstPlaceVotes),
          averageRank: Number(row.averageRank),
        })),
      };
    },
  };
}

async function createPostgresStorage() {
  const { Pool } = require("pg");
  const connectionString = getDatabaseUrl();

  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
      ? false
      : { rejectUnauthorized: false },
  });

  const query = async (text, params = []) => {
    const result = await pool.query(text, params);
    return result;
  };

  await query(`
    CREATE TABLE IF NOT EXISTS votes (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS vote_tracks (
      vote_id TEXT NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
      track_id TEXT NOT NULL,
      name TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      image TEXT,
      spotify_url TEXT,
      rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 15),
      borda_points INTEGER NOT NULL CHECK(borda_points BETWEEN 1 AND 15),
      PRIMARY KEY (vote_id, rank)
    );
  `);

  await query("CREATE INDEX IF NOT EXISTS idx_vote_tracks_track_id ON vote_tracks(track_id);");
  await query("CREATE INDEX IF NOT EXISTS idx_vote_tracks_vote_id ON vote_tracks(vote_id);");

  const countResult = await query("SELECT COUNT(*)::int AS total FROM votes;");
  const totalVotes = Number(countResult.rows[0]?.total || 0);

  if (totalVotes === 0) {
    const legacyVotes = await readLegacyVotes();
    for (const vote of legacyVotes) {
      if (!vote?.id || !Array.isArray(vote.rankedTracks)) continue;
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO votes (id, created_at) VALUES ($1, $2)",
          [vote.id, vote.createdAt || new Date().toISOString()],
        );

        for (const track of vote.rankedTracks) {
          await client.query(
            `
              INSERT INTO vote_tracks (
                vote_id,
                track_id,
                name,
                artist,
                album,
                image,
                spotify_url,
                rank,
                borda_points
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `,
            [
              vote.id,
              track.id,
              track.name,
              track.artist || "",
              track.album || "",
              track.image || null,
              track.spotifyUrl || null,
              track.rank,
              track.bordaPoints,
            ],
          );
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  }

  return {
    kind: "postgres",
    detail: "DATABASE_URL",
    async getVoteCount() {
      const result = await query("SELECT COUNT(*)::int AS total FROM votes;");
      return Number(result.rows[0]?.total || 0);
    },
    async insertVote(vote) {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO votes (id, created_at) VALUES ($1, $2)",
          [vote.id, vote.createdAt],
        );

        for (const track of vote.rankedTracks) {
          await client.query(
            `
              INSERT INTO vote_tracks (
                vote_id,
                track_id,
                name,
                artist,
                album,
                image,
                spotify_url,
                rank,
                borda_points
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `,
            [
              vote.id,
              track.id,
              track.name,
              track.artist || "",
              track.album || "",
              track.image || null,
              track.spotifyUrl || null,
              track.rank,
              track.bordaPoints,
            ],
          );
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async getVoteById(voteId) {
      const voteResult = await query(
        "SELECT id, created_at AS \"createdAt\" FROM votes WHERE id = $1",
        [voteId],
      );

      if (!voteResult.rows[0]) {
        return null;
      }

      const tracksResult = await query(
        `
          SELECT
            track_id AS id,
            name,
            artist,
            album,
            image,
            spotify_url AS "spotifyUrl",
            rank,
            borda_points AS "bordaPoints"
          FROM vote_tracks
          WHERE vote_id = $1
          ORDER BY rank ASC
        `,
        [voteId],
      );

      return {
        ...voteResult.rows[0],
        rankedTracks: tracksResult.rows.map((row) => ({
          ...row,
          rank: Number(row.rank),
          bordaPoints: Number(row.bordaPoints),
        })),
      };
    },
    async getLeaderboard() {
      const totalVotesResult = await query("SELECT COUNT(*)::int AS total FROM votes;");
      const rankingResult = await query(`
        SELECT
          track_id AS id,
          name,
          artist,
          album,
          image,
          spotify_url AS "spotifyUrl",
          SUM(borda_points)::int AS "totalPoints",
          COUNT(*)::int AS appearances,
          SUM(rank)::int AS "rankSum",
          SUM(CASE WHEN rank = 1 THEN 1 ELSE 0 END)::int AS "firstPlaceVotes",
          ROUND(AVG(rank)::numeric, 2) AS "averageRank"
        FROM vote_tracks
        GROUP BY track_id, name, artist, album, image, spotify_url
        ORDER BY "totalPoints" DESC, "firstPlaceVotes" DESC, appearances DESC, name ASC
      `);

      return {
        totalVotes: Number(totalVotesResult.rows[0]?.total || 0),
        ranking: rankingResult.rows.map((row) => ({
          ...row,
          totalPoints: Number(row.totalPoints),
          appearances: Number(row.appearances),
          rankSum: Number(row.rankSum),
          firstPlaceVotes: Number(row.firstPlaceVotes),
          averageRank: Number(row.averageRank),
        })),
      };
    },
  };
}

async function initializeStorage() {
  if (getDatabaseUrl()) {
    storage = await createPostgresStorage();
    return;
  }

  storage = await createSqliteStorage();
}

function getStorage() {
  if (!storage) {
    throw new Error("Storage has not been initialized.");
  }

  return storage;
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/tracks") {
    try {
      const tracks = await loadCatalog();
      return json(res, 200, {
        tracks,
        total: tracks.length,
        source: "local",
        scope: "Official solo Michael Jackson songs from core album releases, deduplicated and excluding remixes.",
      });
    } catch (error) {
      return json(res, 500, {
        error: "Impossible de recuperer le catalogue local.",
        detail: error.message,
      });
    }
  }

  if (req.method === "GET" && pathname === "/api/leaderboard") {
    return json(res, 200, await getStorage().getLeaderboard());
  }

  if (req.method === "GET" && pathname === "/api/health") {
    const tracks = await loadCatalog();
    return json(res, 200, {
      status: "ok",
      storage: getStorage().kind,
      storageDetail: getStorage().detail,
      totalVotes: await getStorage().getVoteCount(),
      catalogSource: "local",
      catalogSize: tracks.length,
    });
  }

  if (req.method === "POST" && pathname === "/api/votes") {
    try {
      const body = await parseBody(req);
      const validationError = validateRankedTracks(body.rankedTracks);
      if (validationError) {
        return json(res, 400, { error: validationError });
      }

      const vote = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        rankedTracks: scoreVote(body.rankedTracks),
      };

      await getStorage().insertVote(vote);

      return json(res, 201, {
        message: "Vote enregistre.",
        vote: await getStorage().getVoteById(vote.id),
        leaderboard: await getStorage().getLeaderboard(),
      });
    } catch (error) {
      return json(res, 500, {
        error: "Impossible d'enregistrer le vote.",
        detail: error.message,
      });
    }
  }

  return false;
}

async function serveStatic(res, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname.startsWith("/api/")) {
    const handled = await handleApi(req, res, pathname);
    if (handled !== false) {
      return;
    }
  }

  await serveStatic(res, pathname);
});

loadDotEnv()
  .then(() => initializeStorage())
  .then(() => loadCatalog())
  .then(() => {
    const port = getPort();
    server.listen(port, "0.0.0.0", () => {
      console.log(`Michael Jackson Top 15 app running on http://0.0.0.0:${port}`);
    });
  })
  .catch((error) => {
    console.error("Startup error:", error);
    process.exit(1);
  });
