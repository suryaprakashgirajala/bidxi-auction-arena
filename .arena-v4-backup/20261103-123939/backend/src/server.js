require("dotenv").config();
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const playersPool = require("./players.json");
const database = require("./database");
const {
  authenticateHttp,
  authenticateSocket,
  registerAccount,
  loginAccount,
  updateDisplayName
} = require("./auth");

const PORT = Number(process.env.PORT || 4000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";
const app = express();
app.use(cors({ origin: CLIENT_ORIGIN.split(",").map((v) => v.trim()), credentials: true }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN.split(",").map((v) => v.trim()), methods: ["GET", "POST"] },
  pingInterval: 25000,
  pingTimeout: 20000
});

// Every game socket must belong to a logged-in account.
io.use(authenticateSocket);

const TEAM_CATALOG = [
  { id: "CSK", name: "Chennai Super Kings", shortName: "CSK", color: "#f6c900", logo: "https://upload.wikimedia.org/wikipedia/en/2/2b/Chennai_Super_Kings_Logo.svg" },
  { id: "MI", name: "Mumbai Indians", shortName: "MI", color: "#1685d4", logo: "https://upload.wikimedia.org/wikipedia/en/c/cd/Mumbai_Indians_Logo.svg" },
  { id: "RCB", name: "Royal Challengers Bengaluru", shortName: "RCB", color: "#e53945", logo: "https://upload.wikimedia.org/wikipedia/en/2/2a/Royal_Challengers_Bengaluru_Logo.svg" },
  { id: "KKR", name: "Kolkata Knight Riders", shortName: "KKR", color: "#8e65bd", logo: "https://upload.wikimedia.org/wikipedia/en/4/4c/Kolkata_Knight_Riders_Logo.svg" },
  { id: "SRH", name: "Sunrisers Hyderabad", shortName: "SRH", color: "#f47722", logo: "https://upload.wikimedia.org/wikipedia/en/8/81/Sunrisers_Hyderabad.svg" },
  { id: "RR", name: "Rajasthan Royals", shortName: "RR", color: "#e45b99", logo: "https://upload.wikimedia.org/wikipedia/en/6/60/Rajasthan_Royals_Logo.svg" },
  { id: "DC", name: "Delhi Capitals", shortName: "DC", color: "#2a66b7", logo: "https://upload.wikimedia.org/wikipedia/en/2/2f/Delhi_Capitals.svg" },
  { id: "PBKS", name: "Punjab Kings", shortName: "PBKS", color: "#d83245", logo: "https://upload.wikimedia.org/wikipedia/en/d/d4/Punjab_Kings_Logo.svg" },
  { id: "GT", name: "Gujarat Titans", shortName: "GT", color: "#1b315e", logo: "https://upload.wikimedia.org/wikipedia/en/0/09/Gujarat_Titans_Logo.svg" },
  { id: "LSG", name: "Lucknow Super Giants", shortName: "LSG", color: "#20a6bd", logo: "https://upload.wikimedia.org/wikipedia/en/a/a9/Lucknow_Super_Giants_IPL_Logo.svg" }
];
const rooms = new Map();
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || min));
const round2 = (value) => Number(Number(value).toFixed(2));
const randomFrom = (items) => items[Math.floor(Math.random() * items.length)];
const shuffle = (items) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};
const cleanName = (value) => String(value || "").trim().replace(/\s+/g, " ").slice(0, 24);
const makeCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
};

function normalizeSettings(input = {}) {
  const teamCount = clamp(input.teamCount, 2, TEAM_CATALOG.length);
  return {
    teamCount,
    humanLimit: clamp(input.humanLimit, 1, teamCount),
    initialPurse: clamp(input.initialPurse, 20, 500),
    maxSquadSize: clamp(input.maxSquadSize, 5, 30),
    bidIncrement: clamp(input.bidIncrement, 0.1, 10),
    timerSeconds: clamp(input.timerSeconds, 5, 60),
    botDifficulty: ["EASY", "MEDIUM", "HARD"].includes(input.botDifficulty) ? input.botDifficulty : "MEDIUM",
    auctioneerMode: input.auctioneerMode === "MANUAL" ? "MANUAL" : "AUTO",
    roomVisibility: input.roomVisibility === "PUBLIC" ? "PUBLIC" : "PRIVATE",
    teamMode: input.teamMode === "CUSTOM" ? "CUSTOM" : "IPL"
  };
}

function createTeam(template, purse) {
  return { ...template, purse, spent: 0, players: [], ownerType: null, ownerId: null, ownerName: null, personality: null };
}

function roomSnapshot(room) {
  const auction = room.auction;
  return {
    code: room.code,
    settings: room.settings,
    status: room.status,
    hostMemberId: room.hostMemberId,
    creatorMemberId: room.creatorMemberId || room.hostMemberId,
    members: room.members.map(({ id, name, teamId, connected, isHost }) => ({ id, name, teamId, connected, isHost })),
    teams: room.teams,
    auction: auction ? {
      currentPlayer: auction.currentPlayer,
      currentBid: auction.currentBid,
      highestBidTeamId: auction.highestBidTeamId,
      bidExpiresAt: auction.bidExpiresAt,
      waitingForDecision: auction.waitingForDecision,
      paused: Boolean(auction.paused),
      pausedRemainingMs: auction.paused ? auction.pausedRemainingMs : null,
      endedEarly: Boolean(auction.endedEarly),
      completedCount: auction.completedCount,
      totalPlayers: auction.totalPlayers,
      lastResult: auction.lastResult,
      history: auction.history.slice(-12),
      playerNumber: auction.playerNumber
    } : null,
    chat: room.chat.slice(-30),
    public: room.settings.roomVisibility === "PUBLIC"
  };
}

function publish(room) {
  io.to(room.code).emit("room:state", roomSnapshot(room));
}

function ackError(ack, message) {
  if (typeof ack === "function") ack({ ok: false, error: message });
}
function ackSuccess(ack, data = {}) {
  if (typeof ack === "function") ack({ ok: true, ...data });
}

function getMember(socket, room) {
  return room.members.find((member) => member.id === socket.data.memberId);
}
function isHost(socket, room) {
  return socket.data.memberId === room.hostMemberId;
}
function isCreator(socket, room) {
  return socket.data.memberId === (room.creatorMemberId || room.hostMemberId);
}
function getRoomForSocket(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}
function getNextBid(room) {
  const auction = room.auction;
  if (!auction || !auction.currentPlayer) return 0;
  return round2(auction.currentBid > 0 ? auction.currentBid + room.settings.bidIncrement : auction.currentPlayer.basePrice);
}
function canTeamBid(room, team) {
  return Boolean(team && team.purse >= getNextBid(room) && team.players.length < room.settings.maxSquadSize);
}

function addHistory(room, type, message, extra = {}) {
  room.auction.history.push({ id: crypto.randomUUID(), type, message, at: Date.now(), ...extra });
}

function saveCompletedAuction(room) {
  const auction = room.auction;
  if (!auction || auction.savedToDatabase) return;
  const soldCount = room.teams.reduce((total, team) => total + team.players.length, 0);
  const totalSpent = round2(room.teams.reduce((total, team) => total + team.spent, 0));
  const host = room.members.find((member) => member.id === room.hostMemberId);
  const auctionId = crypto.randomUUID();
  const completedAt = new Date().toISOString();
  const statements = [{
    sql: `INSERT INTO auctions
      (id, room_code, host_user_id, team_count, sold_count, player_count, total_spent, teams_json, history_json, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      auctionId,
      room.code,
      host?.userId || room.members[0]?.userId,
      room.teams.length,
      soldCount,
      auction.totalPlayers,
      totalSpent,
      JSON.stringify(room.teams),
      JSON.stringify(auction.history),
      completedAt
    ]
  }];

  room.teams.filter((team) => team.ownerType === "HUMAN").forEach((team) => {
    const member = room.members.find((item) => item.id === team.ownerId);
    if (member?.userId) {
      statements.push({
        sql: "INSERT OR IGNORE INTO auction_participants (auction_id, user_id, team_id, team_name) VALUES (?, ?, ?, ?)",
        params: [auctionId, member.userId, team.id, team.shortName]
      });
    }
  });
  if (statements[0].params[2]) {
    try {
      database.runBatch(statements);
      auction.savedToDatabase = true;
    } catch (error) {
      console.error(`[auction] Could not archive room ${room.code}:`, error);
    }
  } else {
    console.error(`[auction] Cannot archive room ${room.code}: host account is missing.`);
  }
}

function openNextPlayer(room) {
  const auction = room.auction;
  if (!auction) return;
  if (auction.playerIndex >= auction.playerOrder.length) {
    room.status = "COMPLETED";
    auction.currentPlayer = null;
    auction.bidExpiresAt = null;
    auction.waitingForDecision = false;
    auction.paused = false;
    auction.pausedRemainingMs = null;
    auction.pausedBotRemainingMs = null;
    addHistory(room, "SYSTEM", "Auction completed. All players have been processed.");
    saveCompletedAuction(room);
    publish(room);
    return;
  }
  const player = auction.playerOrder[auction.playerIndex];
  auction.currentPlayer = player;
  auction.currentBid = 0;
  auction.highestBidTeamId = null;
  auction.bidExpiresAt = Date.now() + room.settings.timerSeconds * 1000;
  auction.waitingForDecision = false;
  auction.botThinkAt = Date.now() + 900 + Math.floor(Math.random() * 1100);
  auction.botBidsThisPlayer = 0;
  auction.lastResult = null;
  auction.playerNumber = auction.playerIndex + 1;
  addHistory(room, "PLAYER", `${player.name} is now up for auction.`, { playerName: player.name });
  publish(room);
}

function finishCurrentPlayer(room, sold, options = {}) {
  const auction = room.auction;
  if (!auction || !auction.currentPlayer || auction.transitionAt) return;
  const player = auction.currentPlayer;
  if (sold && auction.highestBidTeamId) {
    const team = room.teams.find((item) => item.id === auction.highestBidTeamId);
    const amount = auction.currentBid;
    if (!team || team.purse < amount || team.players.length >= room.settings.maxSquadSize) {
      sold = false;
    } else {
      team.purse = round2(team.purse - amount);
      team.spent = round2(team.spent + amount);
      team.players.push({ id: player.id, name: player.name, role: player.role, finalPrice: amount, image: player.image, nationality: player.nationality });
      auction.lastResult = { status: "SOLD", playerName: player.name, teamId: team.id, teamName: team.shortName, amount };
      addHistory(room, "SOLD", `${player.name} sold to ${team.shortName} for ₹${amount.toFixed(2)} Cr.`, { playerName: player.name, teamId: team.id, amount });
    }
  }
  if (!sold) {
    const skippedBy = options.skippedBy || null;
    const reason = options.reason || null;
    auction.lastResult = { status: "UNSOLD", playerName: player.name, teamId: null, teamName: null, amount: null, skippedBy, reason };
    if (skippedBy) {
      addHistory(room, "SKIP", `${player.name} was skipped by ${skippedBy}.`, { playerName: player.name, skippedBy });
    } else {
      addHistory(room, "UNSOLD", `${player.name} went unsold.`, { playerName: player.name, reason });
    }
    auction.currentBid = 0;
    auction.highestBidTeamId = null;
  }
  auction.completedCount += 1;
  auction.playerIndex += 1;
  auction.bidExpiresAt = null;
  auction.waitingForDecision = false;
  auction.botThinkAt = null;
  auction.transitionAt = Date.now() + 1800;
  publish(room);
}

function botMaxBid(room, botTeam, player) {
  const difficultyFactor = { EASY: 0.82, MEDIUM: 1, HARD: 1.16 }[room.settings.botDifficulty];
  const personalityFactor = {
    AGGRESSIVE: 1.22,
    DEFENSIVE: 0.82,
    BALANCED: 1,
    VALUE_HUNTER: 0.9,
    STAR_HUNTER: 1.12
  }[botTeam.personality] || 1;
  const roleCount = botTeam.players.filter((p) => p.role === player.role).length;
  const roleCounts = botTeam.players.reduce((acc, p) => { acc[p.role] = (acc[p.role] || 0) + 1; return acc; }, {});
  const desired = player.role === "Bowler" ? 4 : player.role === "Batter" ? 4 : player.role === "All Rounder" ? 3 : 2;
  const needBonus = roleCount < Math.max(1, desired - 1) ? 0.65 : roleCount < desired ? 0.25 : -0.3;
  const rating = player.rating || 80;
  const roleScarcity = player.role === "Wicket Keeper" ? 0.2 : 0;
  const qualityFactor = 1.35 + (rating / 100) * 1.55 + needBonus + roleScarcity;
  const maxByValue = player.basePrice * qualityFactor * difficultyFactor * personalityFactor;
  const playersNeeded = Math.max(0, room.settings.maxSquadSize - botTeam.players.length);
  const reserve = Math.max(0, playersNeeded - 1) * 0.35;
  const maxByBudget = Math.max(player.basePrice, botTeam.purse - reserve);
  return round2(Math.min(maxByValue, maxByBudget, botTeam.purse));
}

function tryBotBid(room) {
  const auction = room.auction;
  if (!auction || !auction.currentPlayer || auction.waitingForDecision || auction.transitionAt || room.status !== "LIVE") return;
  const now = Date.now();
  if (auction.botBidsThisPlayer >= 7) { auction.botThinkAt = null; return; }
  const nextBid = getNextBid(room);
  const botCandidates = room.teams.filter((team) => team.ownerType === "BOT" && team.id !== auction.highestBidTeamId && canTeamBid(room, team));
  if (!botCandidates.length) { auction.botThinkAt = null; return; }

  const candidates = botCandidates.map((team) => {
    const maxBid = botMaxBid(room, team, auction.currentPlayer);
    const headroom = maxBid - nextBid;
    const roleCount = team.players.filter((p) => p.role === auction.currentPlayer.role).length;
    const roleNeed = Math.max(0, 4 - roleCount);
    const personalityBoost = team.personality === "AGGRESSIVE" ? 0.16 : team.personality === "DEFENSIVE" ? -0.12 : 0;
    const difficultyBoost = room.settings.botDifficulty === "HARD" ? 0.12 : room.settings.botDifficulty === "EASY" ? -0.12 : 0;
    const pricePressure = nextBid / Math.max(1, maxBid);
    const chance = Math.max(0.05, Math.min(0.92, 0.28 + roleNeed * 0.07 + personalityBoost + difficultyBoost - pricePressure * 0.18));
    return { team, maxBid, chance, headroom };
  }).filter((item) => nextBid <= item.maxBid && item.headroom >= -0.001);

  candidates.sort((a, b) => (b.headroom + Math.random() * 0.3) - (a.headroom + Math.random() * 0.3));
  const chosen = candidates.find((item) => Math.random() < item.chance);
  if (chosen) {
    auction.currentBid = nextBid;
    auction.highestBidTeamId = chosen.team.id;
    auction.bidExpiresAt = now + room.settings.timerSeconds * 1000;
    auction.botBidsThisPlayer += 1;
    addHistory(room, "BID", `${chosen.team.shortName} (BOT) bid ₹${nextBid.toFixed(2)} Cr.`, { teamId: chosen.team.id, amount: nextBid, isBot: true });
  }
  auction.botThinkAt = now + 1300 + Math.floor(Math.random() * 1500);
  publish(room);
}

function tickRooms() {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.status !== "LIVE" || !room.auction) continue;
    const auction = room.auction;
    if (auction.paused) continue;
    if (auction.transitionAt && now >= auction.transitionAt) {
      auction.transitionAt = null;
      openNextPlayer(room);
      continue;
    }
    if (auction.waitingForDecision) continue;
    if (auction.bidExpiresAt && now >= auction.bidExpiresAt) {
      if (room.settings.auctioneerMode === "MANUAL") {
        auction.waitingForDecision = true;
        auction.bidExpiresAt = null;
        addHistory(room, "SYSTEM", "Bidding timer ended. Waiting for the auctioneer.");
        publish(room);
      } else {
        finishCurrentPlayer(room, Boolean(auction.highestBidTeamId));
      }
      continue;
    }
    if (auction.botThinkAt && now >= auction.botThinkAt) tryBotBid(room);
  }
}
setInterval(tickRooms, 250);

app.get("/", (_req, res) => res.json({ name: "IPL Auction Arena API", status: "online", version: "1.0.0" }));
app.get("/health", (_req, res) => res.json({ status: "ok", activeRooms: rooms.size, database: "connected" }));

app.post("/api/auth/register", async (req, res) => {
  try {
    const result = await registerAccount(req.body || {});
    res.status(201).json(result);
  } catch (error) {
    const status = /already exists|already taken/.test(error.message) ? 409 : 400;
    res.status(status).json({ error: error.message || "Unable to create account." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const result = await loginAccount(req.body || {});
    res.json(result);
  } catch (error) {
    res.status(401).json({ error: error.message || "Unable to log in." });
  }
});

app.get("/api/auth/me", authenticateHttp, (req, res) => res.json({ user: req.user }));

app.patch("/api/auth/profile", authenticateHttp, (req, res) => {
  try {
    const result = updateDisplayName(req.user.id, req.body?.displayName);
    const user = result.user;
    res.json({ user: { id: user.id, username: user.username, email: user.email, displayName: user.display_name, createdAt: user.created_at }, token: result.token });
  } catch (error) {
    res.status(400).json({ error: error.message || "Unable to update profile." });
  }
});

app.get("/api/me/auctions", authenticateHttp, (req, res) => {
  try {
    const rows = database.all(
      `SELECT a.id, a.room_code, a.team_count, a.sold_count, a.player_count, a.total_spent, a.teams_json, a.history_json, a.completed_at,
              p.team_id AS my_team_id, p.team_name AS my_team_name
       FROM auctions a
       INNER JOIN auction_participants p ON p.auction_id = a.id
       WHERE p.user_id = ?
       ORDER BY a.completed_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json({ auctions: rows.map((row) => ({
      id: row.id,
      roomCode: row.room_code,
      teamCount: row.team_count,
      soldCount: row.sold_count,
      playerCount: row.player_count,
      totalSpent: row.total_spent,
      myTeamId: row.my_team_id,
      myTeamName: row.my_team_name,
      teams: JSON.parse(row.teams_json),
      history: JSON.parse(row.history_json),
      completedAt: row.completed_at
    })) });
  } catch (error) {
    console.error("[history]", error);
    res.status(500).json({ error: "Unable to load auction history." });
  }
});

app.get("/api/me/stats", authenticateHttp, (req, res) => {
  const row = database.get(
    `SELECT COUNT(*) AS auctions_played,
            COALESCE(SUM(CASE WHEN p.team_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS participation_count
     FROM auctions a INNER JOIN auction_participants p ON p.auction_id = a.id
     WHERE p.user_id = ?`,
    [req.user.id]
  ) || { auctions_played: 0, participation_count: 0 };
  res.json({ auctionsPlayed: row.auctions_played, teamsManaged: row.participation_count });
});

app.get("/api/players", (_req, res) => res.json(playersPool));
app.get("/api/teams", (_req, res) => res.json(TEAM_CATALOG));
app.get("/api/rooms", (_req, res) => {
  const publicRooms = [...rooms.values()].filter((room) => room.settings.roomVisibility === "PUBLIC" && room.status === "LOBBY");
  res.json(publicRooms.map((room) => ({ code: room.code, teamCount: room.settings.teamCount, humans: room.members.length, status: room.status })));
});

io.on("connection", (socket) => {
  socket.on("room:create", (payload = {}, ack) => {
    const account = socket.data.user;
    const playerName = cleanName(account?.displayName);
    if (!playerName) return ackError(ack, "Enter your display name first.");
    const settings = normalizeSettings({ ...(payload.settings || {}), teamMode: payload.teamMode || payload.settings?.teamMode });
    const code = makeCode();
    let teamTemplates;
    if (settings.teamMode === "CUSTOM") {
      const allowedBadges = ["★", "⚡", "🛡", "🔥", "🐯", "🦁", "🦅", "👑", "🏏", "💎", "🌪", "⚔"];
      const supplied = Array.isArray(payload.customTeams) ? payload.customTeams : [];
      if (supplied.length !== settings.teamCount) return ackError(ack, `Please configure exactly ${settings.teamCount} custom franchises.`);
      const invalidIndex = supplied.findIndex((item) => {
        const name = cleanName(item?.name).slice(0, 28);
        const shortName = String(item?.shortName || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
        return name.length < 2 || shortName.length < 2;
      });
      if (invalidIndex >= 0) return ackError(ack, `Custom franchise ${invalidIndex + 1} needs a team name and a 2–5 character abbreviation.`);
      teamTemplates = supplied.map((item, index) => {
        const name = cleanName(item?.name).slice(0, 28);
        const shortName = String(item?.shortName || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
        const color = /^#[0-9a-fA-F]{6}$/.test(String(item?.color || "")) ? item.color : "#d6a84f";
        const badge = allowedBadges.includes(item?.badge) ? item.badge : "★";
        return { id: `CUSTOM-${index + 1}`, name, shortName, color, logo: null, badge };
      });
      const uniqueNames = new Set(teamTemplates.map((team) => team.name.toLowerCase()));
      const uniqueShortNames = new Set(teamTemplates.map((team) => team.shortName));
      if (uniqueNames.size !== teamTemplates.length || uniqueShortNames.size !== teamTemplates.length) {
        return ackError(ack, "Custom franchise names and abbreviations must be unique.");
      }
    } else {
      const selectedIds = Array.isArray(payload.selectedTeamIds) ? payload.selectedTeamIds : [];
      const uniqueIds = [...new Set(selectedIds.map((value) => String(value)))];
      teamTemplates = uniqueIds.length === settings.teamCount
        ? uniqueIds.map((id) => TEAM_CATALOG.find((team) => team.id === id)).filter(Boolean)
        : [];
      if (teamTemplates.length !== settings.teamCount) {
        teamTemplates = TEAM_CATALOG;
      }
    }
    const teams = teamTemplates.map((team) => createTeam(team, settings.initialPurse));
    const memberId = crypto.randomUUID();
    const member = { id: memberId, userId: account.id, name: playerName, teamId: null, connected: true, isHost: true };
    const room = {
      code, settings, status: "LOBBY", hostMemberId: memberId, creatorMemberId: memberId, members: [member], teams,
      auction: null, chat: [{ id: crypto.randomUUID(), name: "Arena Bot", text: "Welcome! Choose your franchise, invite friends and start the auction.", at: Date.now(), system: true }],
      createdAt: Date.now()
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.memberId = memberId;
    const snapshot = roomSnapshot(room);
    ackSuccess(ack, { room: snapshot, memberId });
    socket.emit("room:joined", { room: snapshot, memberId });
    publish(room);
  });

  socket.on("room:join", (payload = {}, ack) => {
    const code = String(payload.code || "").trim().toUpperCase();
    const account = socket.data.user;
    const playerName = cleanName(account?.displayName);
    const room = rooms.get(code);
    if (!account || !playerName) return ackError(ack, "Please log in before joining an auction.");
    if (!room) return ackError(ack, "Room not found. Check the code and try again.");

    // Reattach an existing account to its previous seat after a refresh or brief disconnect.
    const existingMember = room.members.find((member) => member.userId === account.id);
    if (existingMember) {
      existingMember.connected = true;
      existingMember.name = playerName;
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.memberId = existingMember.id;
      const snapshot = roomSnapshot(room);
      ackSuccess(ack, { room: snapshot, memberId: existingMember.id, reconnected: true });
      socket.emit("room:joined", { room: snapshot, memberId: existingMember.id });
      publish(room);
      return;
    }
    if (room.status !== "LOBBY") return ackError(ack, "This auction has already started. Only previous participants can reconnect.");
    if (room.members.length >= room.settings.humanLimit) return ackError(ack, "This room has reached its human player limit.");
    if (room.members.some((member) => member.connected && member.name.toLowerCase() === playerName.toLowerCase())) return ackError(ack, "That display name is already being used in this room.");
    const memberId = crypto.randomUUID();
    const member = { id: memberId, userId: account.id, name: playerName, teamId: null, connected: true, isHost: false };
    room.members.push(member);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.memberId = memberId;
    const snapshot = roomSnapshot(room);
    ackSuccess(ack, { room: snapshot, memberId });
    socket.emit("room:joined", { room: snapshot, memberId });
    publish(room);
    room.chat.push({ id: crypto.randomUUID(), name: "Arena Bot", text: `${playerName} joined the lobby.`, at: Date.now(), system: true });
    publish(room);
  });

  socket.on("team:select", (payload = {}, ack) => {
    const room = getRoomForSocket(socket);
    if (!room || room.status !== "LOBBY") return ackError(ack, "Team selection is only available in the lobby.");
    const member = getMember(socket, room);
    const team = room.teams.find((item) => item.id === payload.teamId);
    if (!member || !team) return ackError(ack, "Invalid participant or franchise.");
    if (room.teams.some((item) => item.ownerId === member.id)) return ackError(ack, "You already selected a franchise.");
    if (room.teams.filter((item) => item.ownerId).length >= room.settings.teamCount) return ackError(ack, "All franchise seats for this auction have already been claimed.");
    if (team.ownerId) return ackError(ack, "That franchise has already been selected.");
    team.ownerType = "HUMAN";
    team.ownerId = member.id;
    team.ownerName = member.name;
    member.teamId = team.id;
    ackSuccess(ack);
    publish(room);
  });

  socket.on("team:unselect", (_payload, ack) => {
    const room = getRoomForSocket(socket);
    if (!room || room.status !== "LOBBY") return ackError(ack, "Team selection is only available in the lobby.");
    const member = getMember(socket, room);
    if (!member || !member.teamId) return ackError(ack, "You have not selected a franchise.");
    const team = room.teams.find((item) => item.id === member.teamId);
    if (team) Object.assign(team, { ownerType: null, ownerId: null, ownerName: null });
    member.teamId = null;
    ackSuccess(ack);
    publish(room);
  });

  socket.on("room:start", (_payload, ack) => {
    const room = getRoomForSocket(socket);
    if (!room || !isHost(socket, room)) return ackError(ack, "Only the host can start the auction.");
    if (room.status !== "LOBBY") return ackError(ack, "This auction has already started.");
    if (!room.members.some((member) => member.connected)) return ackError(ack, "At least one human participant is required.");
    const unassignedHuman = room.members.find((member) => member.connected && !member.teamId);
    if (unassignedHuman) return ackError(ack, `Waiting for ${unassignedHuman.name} to select a franchise.`);
    // Release franchises reserved by people who left before the auction began.
    room.members.filter((member) => !member.connected).forEach((member) => {
      const reserved = room.teams.find((team) => team.ownerId === member.id);
      if (reserved) Object.assign(reserved, { ownerType: null, ownerId: null, ownerName: null });
    });
    room.members = room.members.filter((member) => member.connected);
    const personalities = ["AGGRESSIVE", "DEFENSIVE", "BALANCED", "VALUE_HUNTER", "STAR_HUNTER"];
    const humanTeams = room.teams.filter((team) => team.ownerType === "HUMAN");
    const botSeatsNeeded = Math.max(0, room.settings.teamCount - humanTeams.length);
    const botTeams = shuffle(room.teams.filter((team) => !team.ownerId)).slice(0, botSeatsNeeded);
    room.teams = [...humanTeams, ...botTeams];
    botTeams.forEach((team, index) => {
      const personality = randomFrom(personalities);
      team.ownerType = "BOT";
      team.ownerId = `BOT-${crypto.randomUUID()}`;
      team.ownerName = `${personality.replace("_", " ")} Bot ${index + 1}`;
      team.personality = personality;
    });
    room.teams.forEach((team) => { if (team.ownerType === "HUMAN") team.personality = null; });
    room.status = "LIVE";
    room.auction = {
      playerOrder: shuffle(playersPool.map((player) => ({ ...player, rating: 72 + ((player.id * 17) % 25) }))),
      playerIndex: 0,
      currentPlayer: null,
      currentBid: 0,
      highestBidTeamId: null,
      bidExpiresAt: null,
      waitingForDecision: false,
      paused: false,
      pausedRemainingMs: null,
      pausedBotRemainingMs: null,
      endedEarly: false,
      botThinkAt: null,
      botBidsThisPlayer: 0,
      transitionAt: null,
      completedCount: 0,
      totalPlayers: playersPool.length,
      playerNumber: 0,
      lastResult: null,
      history: []
    };
    room.chat.push({ id: crypto.randomUUID(), name: "Arena Bot", text: `Auction started with ${room.settings.teamCount} franchises. ${room.teams.filter((team) => team.ownerType === "BOT").length} AI opponents are in the room.`, at: Date.now(), system: true });
    openNextPlayer(room);
    ackSuccess(ack, { room: roomSnapshot(room) });
  });

  socket.on("auction:bid", (_payload, ack) => {
    const room = getRoomForSocket(socket);
    if (!room || room.status !== "LIVE" || !room.auction || !room.auction.currentPlayer) return ackError(ack, "There is no active auction.");
    const member = getMember(socket, room);
    if (!member || !member.connected || !member.teamId) return ackError(ack, "Select a franchise before bidding.");
    const auction = room.auction;
    if (auction.paused) return ackError(ack, "The host has paused this auction.");
    if (auction.waitingForDecision || auction.transitionAt || !auction.bidExpiresAt || Date.now() >= auction.bidExpiresAt) return ackError(ack, "Bidding is closed for this player.");
    if (auction.highestBidTeamId === member.teamId) return ackError(ack, "Your franchise is already the highest bidder.");
    const team = room.teams.find((item) => item.id === member.teamId);
    const nextBid = getNextBid(room);
    if (!canTeamBid(room, team)) return ackError(ack, "Your franchise does not have enough purse or squad space for this bid.");
    auction.currentBid = nextBid;
    auction.highestBidTeamId = team.id;
    auction.bidExpiresAt = Date.now() + room.settings.timerSeconds * 1000;
    auction.botThinkAt = Date.now() + 900 + Math.floor(Math.random() * 1100);
    addHistory(room, "BID", `${team.shortName} (${member.name}) bid ₹${nextBid.toFixed(2)} Cr.`, { teamId: team.id, amount: nextBid, memberName: member.name });
    ackSuccess(ack, { acceptedBid: nextBid });
    publish(room);
  });

  socket.on("auction:finalize", (payload = {}, ack) => {
    const room = getRoomForSocket(socket);
    if (!room || !isHost(socket, room) || room.status !== "LIVE") return ackError(ack, "Only the host can control the auctioneer.");
    if (room.settings.auctioneerMode !== "MANUAL") return ackError(ack, "Manual auctioneer controls are disabled for this room.");
    if (room.auction?.paused) return ackError(ack, "Resume the auction before making the auctioneer decision.");
    if (!room.auction || !room.auction.currentPlayer || !room.auction.waitingForDecision) return ackError(ack, "The auctioneer can decide after the bidding timer ends.");
    if (payload.result === "SOLD" && !room.auction.highestBidTeamId) return ackError(ack, "No bid was placed, so this player cannot be sold.");
    finishCurrentPlayer(room, payload.result === "SOLD");
    ackSuccess(ack);
  });

  socket.on("auction:pause", (_payload, ack) => {
    const room = getRoomForSocket(socket);
    if (!room || !isCreator(socket, room)) return ackError(ack, "Only the room creator can pause or resume the auction.");
    if (room.status !== "LIVE" || !room.auction || !room.auction.currentPlayer) return ackError(ack, "There is no active auction to pause.");
    const auction = room.auction;
    if (auction.paused) return ackError(ack, "The auction is already paused.");
    if (auction.transitionAt) return ackError(ack, "Wait for the next player to appear before pausing.");
    auction.pausedRemainingMs = auction.bidExpiresAt ? Math.max(0, auction.bidExpiresAt - Date.now()) : 0;
    auction.pausedBotRemainingMs = auction.botThinkAt ? Math.max(0, auction.botThinkAt - Date.now()) : null;
    auction.bidExpiresAt = null;
    auction.botThinkAt = null;
    auction.paused = true;
    addHistory(room, "PAUSE", `Auction paused by ${getMember(socket, room)?.name || "the host"}.`);
    room.chat.push({ id: crypto.randomUUID(), name: "Arena Bot", text: "The host paused the auction. Everyone can take a break.", at: Date.now(), system: true });
    room.chat = room.chat.slice(-60);
    ackSuccess(ack);
    publish(room);
  });

  socket.on("auction:resume", (_payload, ack) => {
    const room = getRoomForSocket(socket);
    if (!room || !isCreator(socket, room)) return ackError(ack, "Only the room creator can resume the auction.");
    if (room.status !== "LIVE" || !room.auction || !room.auction.paused) return ackError(ack, "The auction is not paused.");
    const auction = room.auction;
    const now = Date.now();
    if (!auction.waitingForDecision) auction.bidExpiresAt = now + Math.max(1000, Number(auction.pausedRemainingMs) || 0);
    auction.botThinkAt = auction.pausedBotRemainingMs === null ? null : now + Math.max(500, auction.pausedBotRemainingMs);
    auction.paused = false;
    auction.pausedRemainingMs = null;
    auction.pausedBotRemainingMs = null;
    addHistory(room, "RESUME", `Auction resumed by ${getMember(socket, room)?.name || "the host"}.`);
    room.chat.push({ id: crypto.randomUUID(), name: "Arena Bot", text: "The auction is back live. Bidding is open!", at: Date.now(), system: true });
    room.chat = room.chat.slice(-60);
    ackSuccess(ack);
    publish(room);
  });

  socket.on("auction:skip", (_payload, ack) => {
    const room = getRoomForSocket(socket);
    const member = room && getMember(socket, room);
    if (!room || room.status !== "LIVE" || !room.auction || !room.auction.currentPlayer) return ackError(ack, "There is no active player to skip.");
    if (!member || !member.connected || !member.teamId) return ackError(ack, "Only an active franchise participant can skip a player.");
    if (room.auction.paused) return ackError(ack, "Resume the auction before skipping a player.");
    if (room.auction.transitionAt) return ackError(ack, "The current player is already being finalized.");
    finishCurrentPlayer(room, false, { skippedBy: member.name, reason: "Participant skip" });
    ackSuccess(ack);
  });

  socket.on("room:end", (_payload, ack) => {
    const room = getRoomForSocket(socket);
    if (!room || !isCreator(socket, room)) return ackError(ack, "Only the room creator can end this auction.");
    if (room.status !== "LIVE" || !room.auction) return ackError(ack, "There is no live auction to end.");
    const auction = room.auction;
    auction.endedEarly = auction.playerIndex < auction.playerOrder.length;
    auction.currentPlayer = null;
    auction.bidExpiresAt = null;
    auction.botThinkAt = null;
    auction.transitionAt = null;
    auction.waitingForDecision = false;
    auction.paused = false;
    auction.pausedRemainingMs = null;
    auction.pausedBotRemainingMs = null;
    room.status = "COMPLETED";
    addHistory(room, "END", `Auction ended early by host ${getMember(socket, room)?.name || "the creator"}.`);
    room.chat.push({ id: crypto.randomUUID(), name: "Arena Bot", text: "The host ended the auction. Final franchise squads are ready.", at: Date.now(), system: true });
    room.chat = room.chat.slice(-60);
    saveCompletedAuction(room);
    ackSuccess(ack);
    publish(room);
  });

  socket.on("chat:send", (payload = {}, ack) => {
    const room = getRoomForSocket(socket);
    const member = room && getMember(socket, room);
    const text = String(payload.text || "").trim().slice(0, 240);
    if (!room || !member || !text) return ackError(ack, "Enter a message first.");
    room.chat.push({ id: crypto.randomUUID(), name: member.name, text, at: Date.now(), system: false });
    room.chat = room.chat.slice(-60);
    ackSuccess(ack);
    publish(room);
  });

  socket.on("room:leave", (_payload, ack) => {
    const room = getRoomForSocket(socket);
    if (!room) return ackSuccess(ack);
    const member = getMember(socket, room);
    if (room.status === "LOBBY" && member && member.teamId) {
      const team = room.teams.find((item) => item.id === member.teamId);
      if (team) Object.assign(team, { ownerType: null, ownerId: null, ownerName: null });
    }
    if (member) {
      room.members = room.members.filter((item) => item.id !== member.id);
      if (room.hostMemberId === member.id && room.members.length) {
        room.hostMemberId = room.members[0].id;
        room.members.forEach((item) => { item.isHost = item.id === room.hostMemberId; });
      }
      if (room.creatorMemberId === member.id && room.members.length) {
        room.creatorMemberId = room.hostMemberId;
      }
    }
    socket.leave(room.code);
    socket.data.roomCode = null;
    socket.data.memberId = null;
    if (room.members.length === 0) rooms.delete(room.code); else publish(room);
    ackSuccess(ack);
  });

  socket.on("disconnect", () => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    const member = getMember(socket, room);
    if (member) {
      member.connected = false;
      if (room.hostMemberId === member.id) {
        const nextHost = room.members.find((item) => item.connected);
        if (nextHost) {
          room.hostMemberId = nextHost.id;
          room.members.forEach((item) => { item.isHost = item.id === nextHost.id; });
        }
      }
      room.chat.push({ id: crypto.randomUUID(), name: "Arena Bot", text: `${member.name} disconnected.`, at: Date.now(), system: true });
      publish(room);
    }
  });
});

async function startServer() {
  await database.initializeDatabase();
  server.listen(PORT, () => {
    console.log(`IPL Auction Arena API listening on http://localhost:${PORT}`);
    console.log(`SQLite database: ${database.databasePath}`);
  });
}

startServer().catch((error) => {
  console.error("Unable to initialize IPL Auction Arena:", error);
  process.exit(1);
});
