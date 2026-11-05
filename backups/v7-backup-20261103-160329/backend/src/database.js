const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

const databasePath = path.resolve(process.env.DATABASE_FILE || path.join(__dirname, "..", "data", "arena.sqlite"));
let database = null;

async function initializeDatabase() {
  const wasmDirectory = path.dirname(require.resolve("sql.js"));
  const SQL = await initSqlJs({ locateFile: (file) => path.join(wasmDirectory, file) });
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  database = fs.existsSync(databasePath)
    ? new SQL.Database(fs.readFileSync(databasePath))
    : new SQL.Database();

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

    CREATE INDEX IF NOT EXISTS idx_auction_participants_user ON auction_participants(user_id);
    CREATE INDEX IF NOT EXISTS idx_auctions_completed_at ON auctions(completed_at DESC);
  `);
  persistDatabase();
  return database;
}

function getDatabase() {
  if (!database) throw new Error("Database has not been initialized.");
  return database;
}

function persistDatabase() {
  if (!database) return;
  const bytes = database.export();
  fs.writeFileSync(databasePath, Buffer.from(bytes));
}

function run(sql, params = []) {
  getDatabase().run(sql, params);
  persistDatabase();
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
    persistDatabase();
  } catch (error) {
    db.run("ROLLBACK;");
    throw error;
  }
}

module.exports = { initializeDatabase, getDatabase, run, get, all, runBatch, persistDatabase, databasePath };
