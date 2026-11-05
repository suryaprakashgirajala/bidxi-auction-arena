const crypto = require("crypto");
const { promisify } = require("util");
const { get, run } = require("./database");

const scrypt = promisify(crypto.scrypt);
const JWT_SECRET = process.env.JWT_SECRET || "development-only-secret-change-this-before-deploying-ipl-arena";
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be configured before running in production.");
  }
  console.warn("[security] JWT_SECRET is not set. A development-only fallback is being used; configure a private secret before deploying.");
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    sub: user.id,
    username: user.username,
    displayName: user.display_name,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS
  }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

function verifyToken(token) {
  if (typeof token !== "string") throw new Error("Missing session token.");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid session token.");
  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac("sha256", JWT_SECRET).update(unsigned).digest();
  const actual = Buffer.from(parts[2], "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error("Invalid session token.");
  }
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  if (header.alg !== "HS256" || !payload.sub || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("Your session has expired. Please log in again.");
  }
  return payload;
}

async function hashPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return { salt: salt.toString("hex"), hash: Buffer.from(derived).toString("hex") };
}

async function verifyPassword(password, saltHex, expectedHashHex) {
  const result = await hashPassword(password, saltHex);
  const expected = Buffer.from(expectedHashHex, "hex");
  const actual = Buffer.from(result.hash, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at
  };
}

function bearerToken(req) {
  const value = req.headers.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : null;
}

function authenticateHttp(req, res, next) {
  try {
    const payload = verifyToken(bearerToken(req));
    const user = get("SELECT id, username, email, display_name, created_at FROM users WHERE id = ?", [payload.sub]);
    if (!user) return res.status(401).json({ error: "Account not found. Please log in again." });
    req.user = publicUser(user);
    next();
  } catch (error) {
    res.status(401).json({ error: error.message || "Authentication required." });
  }
}

function authenticateSocket(socket, next) {
  try {
    const payload = verifyToken(socket.handshake.auth?.token);
    const user = get("SELECT id, username, email, display_name FROM users WHERE id = ?", [payload.sub]);
    if (!user) return next(new Error("Account not found. Please log in again."));
    socket.data.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.display_name
    };
    next();
  } catch (error) {
    next(new Error(error.message || "Authentication required."));
  }
}

async function registerAccount({ username, email, displayName, password }) {
  const safeUsername = String(username || "").trim();
  const safeEmail = String(email || "").trim().toLowerCase();
  const safeDisplayName = String(displayName || "").trim().replace(/\s+/g, " ").slice(0, 24);
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(safeUsername)) {
    throw new Error("Username must be 3–20 characters and use only letters, numbers or underscores.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail) || safeEmail.length > 254) {
    throw new Error("Enter a valid email address.");
  }
  if (safeDisplayName.length < 2) throw new Error("Display name must contain at least 2 characters.");
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new Error("Password must be between 8 and 128 characters.");
  }
  if (get("SELECT id FROM users WHERE username = ? COLLATE NOCASE", [safeUsername])) {
    throw new Error("That username is already taken.");
  }
  if (get("SELECT id FROM users WHERE email = ? COLLATE NOCASE", [safeEmail])) {
    throw new Error("An account with that email already exists.");
  }
  const { salt, hash } = await hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    username: safeUsername,
    email: safeEmail,
    display_name: safeDisplayName,
    password_hash: hash,
    password_salt: salt,
    created_at: new Date().toISOString()
  };
  run(
    "INSERT INTO users (id, username, email, display_name, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [user.id, user.username, user.email, user.display_name, user.password_hash, user.password_salt, user.created_at]
  );
  return { user: publicUser(user), token: signToken(user) };
}

async function loginAccount({ identifier, password }) {
  const login = String(identifier || "").trim();
  if (!login || typeof password !== "string" || !password) throw new Error("Enter your email/username and password.");
  const user = get(
    "SELECT id, username, email, display_name, password_hash, password_salt, created_at FROM users WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE",
    [login, login]
  );
  if (!user || !(await verifyPassword(password, user.password_salt, user.password_hash))) {
    throw new Error("Incorrect username/email or password.");
  }
  return { user: publicUser(user), token: signToken(user) };
}

function updateDisplayName(userId, value) {
  const displayName = String(value || "").trim().replace(/\s+/g, " ").slice(0, 24);
  if (displayName.length < 2) throw new Error("Display name must contain at least 2 characters.");
  run("UPDATE users SET display_name = ? WHERE id = ?", [displayName, userId]);
  const user = get("SELECT id, username, email, display_name, created_at FROM users WHERE id = ?", [userId]);
  return { user, token: signToken(user) };
}

module.exports = {
  signToken,
  verifyToken,
  authenticateHttp,
  authenticateSocket,
  registerAccount,
  loginAccount,
  updateDisplayName,
  publicUser
};
