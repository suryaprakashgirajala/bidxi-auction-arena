const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");
const { Pool } = require("pg");

// Local development keeps using the existing SQLite file. When DATABASE_URL is
// configured (Render), the SQLite database snapshot is stored durably in Neon.
const databasePath = path.resolve(
  process.env.DATABASE_FILE || path.join(__dirname, "..", "data", "arena.sqlite")
);

let database = null;
let postgresPool = null;
let persistQueue = Promise.resolve();
let lastPersistError = null;

async function initializeDatabase() {
  const wasmDirectory = path.dirname(require.resolve("sql.js"));
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(wasmDirectory, file)
  });

  if (process.env.DATABASE_URL) {
    postgresPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000,
      keepAlive: true
    });

    // Fail startup clearly rather than silently falling back to ephemeral disk.
    await postgresPool.query("SELECT 1");
    await postgresPool.query(`
      CREATE TABLE IF NOT EXISTS bidxi_persistent_state (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        sqlite_data BYTEA NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const result = await postgresPool.query(
      "SELECT sqlite_data FROM bidxi_persistent_state WHERE id = 1"
    );

    if (result.rows.length) {
      database = new SQL.Database(new Uint8Array(result.rows[0].sqlite_data));
      console.log("[database] Restored BIDXI SQLite snapshot from Neon PostgreSQL.");
    } else if (fs.existsSync(databasePath)) {
      // One-time migration path: preserve an old on-disk SQLite DB if the
      // Render instance still has it when DATABASE_URL is first configured.
      database = new SQL.Database(fs.readFileSync(databasePath));
      console.log("[database] Found the previous local SQLite file; importing it into Neon.");
    } else {
      database = new SQL.Database();
      console.log("[database] Created a new BIDXI database snapshot in Neon PostgreSQL.");
    }
  } else {
    // Local development fallback: preserve the current SQLite-file behavior.
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    database = fs.existsSync(databasePath)
      ? new SQL.Database(fs.readFileSync(databasePath))
      : new SQL.Database();
    console.log(`[database] Using local SQLite file: ${databasePath}`);
  }

  database.run("PRAGMA foreign_keys = ON;");
  database.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auctions (
      id TEXT PRIMARY KEY,
      room_code TEXT NOT NULL,
      host_user_id TEXT NOT NULL,
      team_count INTEGER NOT NULL,
      sold_count INTEGER NOT NULL,
      player_count INTEGER NOT NULL,
      total_spent REAL NOT NULL,
      teams_json TEXT NOT NULL,
      history_json TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      FOREIGN KEY (host_user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS auction_participants (
      auction_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      team_name TEXT NOT NULL,
      PRIMARY KEY (auction_id, user_id),
      FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS player_catalog (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT,
      player_json TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_player_catalog_owner ON player_catalog(owner_user_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_auction_participants_user ON auction_participants(user_id);
    CREATE INDEX IF NOT EXISTS idx_auctions_completed_at ON auctions(completed_at DESC);
  `);

  // Ensure the initial schema is saved to Neon before the HTTP server starts.
  await persistDatabase();
  await flushPersistentStore();
  return database;
}

function getDatabase() {
  if (!database) throw new Error("Database has not been initialized.");
  return database;
}

function persistDatabase() {
  if (!database) return Promise.resolve();
  const bytes = Buffer.from(database.export());

  if (!postgresPool) {
    fs.writeFileSync(databasePath, bytes);
    return Promise.resolve();
  }

  // Queue snapshots in order so a slower earlier write cannot overwrite a newer one.
  const snapshot = Buffer.from(bytes);
  persistQueue = persistQueue.then(async () => {
    try {
      await postgresPool.query(
        `INSERT INTO bidxi_persistent_state (id, sqlite_data, updated_at)
         VALUES (1, $1, NOW())
         ON CONFLICT (id) DO UPDATE
         SET sqlite_data = EXCLUDED.sqlite_data, updated_at = NOW()`,
        [snapshot]
      );
      lastPersistError = null;
    } catch (error) {
      lastPersistError = error;
      console.error("[database] Failed to save BIDXI database snapshot to Neon:", error);
    }
  });
  return persistQueue;
}

async function flushPersistentStore() {
  await persistQueue;
  if (lastPersistError) {
    throw new Error(`Unable to persist BIDXI data to Neon: ${lastPersistError.message}`);
  }
}

function run(sql, params = []) {
  getDatabase().run(sql, params);
  // Local mode resolves immediately; Neon mode resolves after the snapshot is saved.
  return persistDatabase();
}

function get(sql, params = []) {
  const statement = getDatabase().prepare(sql);
  try {
    statement.bind(params);
    return statement.step() ? statement.getAsObject() : null;
  } finally {
    statement.free();
  }
}

function all(sql, params = []) {
  const statement = getDatabase().prepare(sql);
  const rows = [];
  try {
    statement.bind(params);
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally {
    statement.free();
  }
}

function runBatch(statements) {
  const db = getDatabase();
  db.run("BEGIN TRANSACTION;");
  try {
    for (const item of statements) db.run(item.sql, item.params || []);
    db.run("COMMIT;");
    return persistDatabase();
  } catch (error) {
    db.run("ROLLBACK;");
    throw error;
  }
}

module.exports = {
  initializeDatabase,
  getDatabase,
  run,
  get,
  all,
  runBatch,
  persistDatabase,
  flushPersistentStore,
  databasePath
};
