require("dotenv").config();
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const playersPool = require("./players.json");
const database = require("./database");
const { chooseBotBid, getPersonalityLabel } = require("./aiEngine");
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
const formatMoney = (value) => `₹${Number(value || 0).toFixed(2)} Cr`;
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
    roomVisibility: input.roomVisibility === "PUBLIC" ? "PUBLIC" : "PRIVATE"
  };
}

const SEAT_COLORS = ["#e8ae3a", "#3289df", "#e05262", "#8a6bd1", "#17a99a", "#e47c39", "#d95e9a", "#6e8cac", "#7e9a42", "#8b6548"];
const CUSTOM_BADGES = ["★", "⚡", "🛡", "🔥", "🐯", "🦁", "🦅", "👑", "🏏", "💎", "🌪", "⚔"];

function createTeamSlot(index, purse) {
  return {
    id: `SEAT-${index + 1}`,
    catalogId: null,
    name: `Franchise ${index + 1}`,
    shortName: `TEAM${index + 1}`,
    color: SEAT_COLORS[index % SEAT_COLORS.length],
    logo: null,
    badge: "★",
    isCustom: false,
    purse,
    spent: 0,
    players: [],
    ownerType: null,
    ownerId: null,
    ownerName: null,
    personality: null
  };
}

function resetTeamSlot(team, index) {
  const empty = createTeamSlot(index, team.purse);
  Object.assign(team, empty);
}

function addRoomMessage(room, name, text, system = true) {
  room.chat.push({ id: crypto.randomUUID(), name, text: String(text).slice(0, 240), at: Date.now(), system });
  room.chat = room.chat.slice(-80);
}

function roomSnapshot(room) {
  const auction = room.auction;
  return {
    code: room.code,
    settings: room.settings,
    status: room.status,
    hostMemberId: room.hostMemberId,
    creatorMemberId: room.creatorMemberId || room.hostMemberId,
    members: room.members.map(({ id, name, teamId, connected, isHost, teamChoiceType }) => ({ id, name, teamId, connected, isHost, teamChoiceType })),
    teams: room.teams,
    auction: auction ? {
      currentPlayer: auction.currentPlayer,
      currentBid: auction.currentBid,
      highestBidTeamId: auction.highestBidTeamId,
      passedTeamIds: auction.passedTeamIds || [],
      bidExpiresAt: auction.bidExpiresAt,
      waitingForDecision: auction.waitingForDecision,
      transitioning: Boolean(auction.transitionAt),
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
  const passed = room.auction?.passedTeamIds || [];
  return Boolean(team && !passed.includes(team.id) && team.purse >= getNextBid(room) && team.players.length < room.settings.maxSquadSize);
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
    addRoomMessage(room, "ARENA BOT", "🏆 Auction completed! Final franchise squads are ready for everyone to view.", true);
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
  auction.passedTeamIds = [];
  auction.lastResult = null;
  auction.playerNumber = auction.playerIndex + 1;
  addHistory(room, "PLAYER", `${player.name} is now up for auction.`, { playerName: player.name });
  addRoomMessage(room, "AUCTION DESK", `LOT #${String(auction.playerNumber).padStart(3, "0")}: ${player.name} (${player.role}) is now up for auction. Base price ${formatMoney(player.basePrice)}.`, true);
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
      team.players.push({ id: player.id, name: player.name, role: player.role, finalPrice: amount, image: player.image, nationality: player.nationality, arenaRating: player.arenaRating });
      auction.lastResult = { status: "SOLD", playerName: player.name, teamId: team.id, teamName: team.shortName, amount };
      const saleMessage = `${player.name} SOLD to ${team.shortName} (${team.ownerName || team.name}) for ${formatMoney(amount)}.`;
      addHistory(room, "SOLD", saleMessage, { playerName: player.name, teamId: team.id, amount });
      addRoomMessage(room, "AUCTION DESK", `🔨 ${saleMessage}`, true);
    }
  }
  if (!sold) {
    const skippedBy = options.skippedBy || null;
    const reason = options.reason || null;
    auction.lastResult = { status: "UNSOLD", playerName: player.name, teamId: null, teamName: null, amount: null, skippedBy, reason };
    if (skippedBy) {
      const skipMessage = `${player.name} was moved on by ${skippedBy}.`;
      addHistory(room, "SKIP", skipMessage, { playerName: player.name, skippedBy });
      addRoomMessage(room, "AUCTION DESK", skipMessage, true);
    } else {
      const unsoldMessage = `${player.name} went UNSOLD. No franchise completed a winning bid.`;
      addHistory(room, "UNSOLD", unsoldMessage, { playerName: player.name, reason });
      addRoomMessage(room, "AUCTION DESK", unsoldMessage, true);
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

function tryBotBid(room) {
  const auction = room.auction;
  if (!auction || !auction.currentPlayer || auction.waitingForDecision || auction.transitionAt || room.status !== "LIVE" || auction.paused) return;

  const now = Date.now();
  const botTeams = room.teams.filter((team) => team.ownerType === "BOT");
  const maxBotBidsForLot = Math.max(6, botTeams.length * 2);
  if (auction.botBidsThisPlayer >= maxBotBidsForLot) {
    auction.botThinkAt = null;
    return;
  }

  const nextBid = getNextBid(room);
  const botCandidates = botTeams.filter((team) =>
    team.id !== auction.highestBidTeamId && canTeamBid(room, team)
  );
  if (!botCandidates.length) {
    auction.botThinkAt = null;
    return;
  }

  const decision = chooseBotBid(room, botCandidates, nextBid);
  if (decision) {
    const chosen = decision.team;
    auction.currentBid = nextBid;
    auction.highestBidTeamId = chosen.id;
    auction.bidExpiresAt = now + room.settings.timerSeconds * 1000;
    auction.botBidsThisPlayer += 1;

    const personalityLabel = getPersonalityLabel(chosen.personality);
    const bidMessage = `${chosen.shortName} (${personalityLabel}) bid ${formatMoney(nextBid)} for ${auction.currentPlayer.name} — ${decision.reason}.`;
    addHistory(room, "BID", bidMessage, {
      teamId: chosen.id,
      amount: nextBid,
      isBot: true,
      personality: chosen.personality,
      arenaRating: decision.rating,
      reason: decision.reason
    });
    addRoomMessage(room, "AI FRANCHISE", bidMessage, true);
  }

  // Bots think again after a short, varied delay. The shared auction clock remains authoritative.
  auction.botThinkAt = now + 1050 + Math.floor(Math.random() * 1050);
  if (decision) publish(room);
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

app.get("/", (_req, res) => res.json({ name: "IPL Auction Arena API", status: "online", version: "1.2.0" }));
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
    const settings = normalizeSettings(payload.settings || {});
    const code = makeCode();
    // Every participant chooses their own franchise style after entering the lobby.
    const teams = Array.from({ length: settings.teamCount }, (_, index) => createTeamSlot(index, settings.initialPurse));
    const memberId = crypto.randomUUID();
    const member = { id: memberId, userId: account.id, name: playerName, teamId: null, teamChoiceType: null, connected: true, isHost: true };
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
    if (room.members.filter((member) => member.connected).length >= room.settings.humanLimit) return ackError(ack, "This room has reached its human player limit.");
    if (room.members.some((member) => member.connected && member.name.toLowerCase() === playerName.toLowerCase())) return ackError(ack, "That display name is already being used in this room.");
    const memberId = crypto.randomUUID();
    const member = { id: memberId, userId: account.id, name: playerName, teamId: null, teamChoiceType: null, connected: true, isHost: false };
    room.members.push(member);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.memberId = memberId;
    const snapshot = roomSnapshot(room);
    ackSuccess(ack, { room: snapshot, memberId });
    socket.emit("room:joined", { room: snapshot, memberId });
    publish(room);
    addRoomMessage(room, "ARENA BOT", `${playerName} joined the lobby.`, true);
    publish(room);
  });

  socket.on("team:select", (payload = {}, ack) => {
    const room = getRoomForSocket(socket);
    if (!room || room.status !== "LOBBY") return ackError(ack, "Team selection is only available in the lobby.");
    const member = getMember(socket, room);
    if (!member) return ackError(ack, "Participant not found.");
    if (member.teamId) return ackError(ack, "You already selected a franchise. Release it before choosing another.");
    const occupiedSeats = room.teams.filter((team) => team.ownerId).length;
    if (occupiedSeats >= room.settings.teamCount) return ackError(ack, "All franchise seats are already claimed.");
    const seat = room.teams.find((team) => !team.ownerId);
    if (!seat) return ackError(ack, "No franchise seats are available.");

    const type = String(payload.type || "IPL").toUpperCase();
    let identity;
    if (type === "IPL") {
      const catalog = TEAM_CATALOG.find((team) => team.id === String(payload.teamId || "").toUpperCase());
      if (!catalog) return ackError(ack, "Choose a valid IPL franchise.");
      if (room.teams.some((team) => team.ownerId && team.catalogId === catalog.id)) return ackError(ack, "That IPL franchise has already been selected by another participant.");
      identity = { ...catalog, catalogId: catalog.id, badge: null, isCustom: false };
    } else if (type === "CUSTOM") {
      const name = String(payload.name || "").trim().replace(/\s+/g, " ").slice(0, 28);
      const shortName = String(payload.shortName || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
      const color = /^#[0-9a-fA-F]{6}$/.test(String(payload.color || "")) ? payload.color : "#d6a84f";
      const badge = CUSTOM_BADGES.includes(payload.badge) ? payload.badge : "★";
      const suppliedLogo = typeof payload.logo === "string" ? payload.logo : "";
      const logo = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(suppliedLogo) && suppliedLogo.length <= 170000 ? suppliedLogo : null;
      if (suppliedLogo && !logo) return ackError(ack, "Custom logos must be PNG, JPG or WEBP images smaller than 120 KB.");
      if (name.length < 2 || shortName.length < 2) return ackError(ack, "Enter a team name (2–28 characters) and abbreviation (2–5 letters/numbers).");
      const normalizedName = name.toLowerCase();
      const normalizedShort = shortName.toLowerCase();
      if (room.teams.some((team) => team.ownerId && (team.name.toLowerCase() === normalizedName || team.shortName.toLowerCase() === normalizedShort))) {
        return ackError(ack, "That custom team name or abbreviation is already in use in this room.");
      }
      identity = { id: seat.id, catalogId: null, name, shortName, color, logo, badge, isCustom: true };
    } else {
      return ackError(ack, "Choose either an official IPL franchise or a custom franchise.");
    }

    Object.assign(seat, identity, {
      id: seat.id,
      purse: room.settings.initialPurse,
      spent: 0,
      players: [],
      ownerType: "HUMAN",
      ownerId: member.id,
      ownerName: member.name,
      personality: null
    });
    member.teamId = seat.id;
    member.teamChoiceType = type;
    addRoomMessage(room, "ARENA BOT", `${member.name} selected ${seat.name} (${type === "CUSTOM" ? "custom franchise" : "IPL franchise"}).`, true);
    ackSuccess(ack, { teamId: seat.id });
    publish(room);
  });

  socket.on("team:unselect", (_payload, ack) => {
    const room = getRoomForSocket(socket);
    if (!room || room.status !== "LOBBY") return ackError(ack, "Team selection is only available in the lobby.");
    const member = getMember(socket, room);
    if (!member || !member.teamId) return ackError(ack, "You have not selected a franchise.");
    const teamIndex = room.teams.findIndex((item) => item.id === member.teamId);
    if (teamIndex >= 0) resetTeamSlot(room.teams[teamIndex], teamIndex);
    member.teamId = null;
    member.teamChoiceType = null;
    addRoomMessage(room, "ARENA BOT", `${member.name} released their franchise selection.`, true);
    ackSuccess(ack);
    publish(room);
  });

  socket.on("room:start", (_payload, ack) => {
    const room = getRoomForSocket(socket);
    if (!room || !isCreator(socket, room)) return ackError(ack, "Only the room creator can start the auction.");
    if (room.status !== "LOBBY") return ackError(ack, "This auction has already started.");
    const connectedMembers = room.members.filter((member) => member.connected);
    if (!connectedMembers.length) return ackError(ack, "At least one human participant is required.");
    const unassignedHuman = connectedMembers.find((member) => !member.teamId);
    if (unassignedHuman) return ackError(ack, `Waiting for ${unassignedHuman.name} to select their franchise.`);

    // Remove disconnected lobby participants and free their seats.
    room.members.filter((member) => !member.connected).forEach((member) => {
      const seatIndex = room.teams.findIndex((team) => team.ownerId === member.id);
      if (seatIndex >= 0) resetTeamSlot(room.teams[seatIndex], seatIndex);
    });
    room.members = connectedMembers;
    const humanTeams = room.teams.filter((team) => team.ownerType === "HUMAN");
    if (humanTeams.length !== connectedMembers.length) return ackError(ack, "Every connected participant must select one franchise before the auction starts.");

    const personalities = shuffle(["AGGRESSIVE", "DEFENSIVE", "BALANCED", "VALUE_HUNTER", "STAR_HUNTER"]);
    const usedCatalogIds = new Set(humanTeams.map((team) => team.catalogId).filter(Boolean));
    const availableBotCatalog = shuffle(TEAM_CATALOG.filter((team) => !usedCatalogIds.has(team.id)));
    const openSeats = room.teams.filter((team) => !team.ownerId);
    if (availableBotCatalog.length < openSeats.length) return ackError(ack, "Not enough franchise identities remain for AI opponents.");
    openSeats.forEach((seat, index) => {
      const template = availableBotCatalog[index];
      const personality = personalities[index % personalities.length];
      Object.assign(seat, template, {
        id: seat.id,
        catalogId: template.id,
        isCustom: false,
        badge: null,
        purse: room.settings.initialPurse,
        spent: 0,
        players: [],
        ownerType: "BOT",
        ownerId: `BOT-${crypto.randomUUID()}`,
        ownerName: `${personality.replace("_", " ")} Bot ${index + 1}`,
        personality
      });
    });

    room.status = "LIVE";
    room.auction = {
      playerOrder: shuffle(playersPool.map((player) => ({ ...player }))),
      playerIndex: 0,
      currentPlayer: null,
      currentBid: 0,
      highestBidTeamId: null,
      passedTeamIds: [],
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
    const botCount = room.teams.filter((team) => team.ownerType === "BOT").length;
    addRoomMessage(room, "ARENA BOT", `Auction started with ${room.settings.teamCount} franchises, ${humanTeams.length} human participants and ${botCount} AI rivals.`, true);
    addHistory(room, "SYSTEM", `Auction started with ${room.settings.teamCount} franchises.`);
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
    if ((auction.passedTeamIds || []).includes(member.teamId)) return ackError(ack, "Your franchise has passed on this player and can bid again on the next lot.");
    const nextBid = getNextBid(room);
    if (!canTeamBid(room, team)) return ackError(ack, "Your franchise does not have enough purse or squad space for this bid.");
    auction.currentBid = nextBid;
    auction.highestBidTeamId = team.id;
    auction.bidExpiresAt = Date.now() + room.settings.timerSeconds * 1000;
    auction.botThinkAt = Date.now() + 900 + Math.floor(Math.random() * 1100);
    const bidMessage = `${team.shortName} (${member.name}) bid ${formatMoney(nextBid)} for ${auction.currentPlayer.name}.`;
    addHistory(room, "BID", bidMessage, { teamId: team.id, amount: nextBid, memberName: member.name });
    addRoomMessage(room, "LIVE BID", bidMessage, true);
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
    addRoomMessage(room, "ARENA BOT", "The host paused the auction. Everyone can take a break.", true);
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
    addRoomMessage(room, "ARENA BOT", "The auction is back live. Bidding is open!", true);
    ackSuccess(ack);
    publish(room);
  });

  socket.on("auction:pass", (_payload, ack) => {
    const room = getRoomForSocket(socket);
    const member = room && getMember(socket, room);
    if (!room || room.status !== "LIVE" || !room.auction || !room.auction.currentPlayer) return ackError(ack, "There is no active player to pass on.");
    if (!member || !member.connected || !member.teamId) return ackError(ack, "Only a franchise participant can pass on a player.");
    const auction = room.auction;
    if (auction.paused) return ackError(ack, "Resume the auction before passing on this player.");
    if (auction.waitingForDecision || auction.transitionAt || !auction.bidExpiresAt) return ackError(ack, "Bidding is not currently open.");
    if (auction.highestBidTeamId === member.teamId) return ackError(ack, "Your franchise is currently leading. You cannot pass while holding the highest bid.");
    if ((auction.passedTeamIds || []).includes(member.teamId)) return ackError(ack, "Your franchise has already passed on this player.");
    const team = room.teams.find((item) => item.id === member.teamId);
    if (!team) return ackError(ack, "Your franchise was not found.");

    auction.passedTeamIds = [...(auction.passedTeamIds || []), member.teamId];
    const passMessage = `${team.shortName} (${member.name}) PASSED on ${auction.currentPlayer.name}. They are watching while the remaining franchises continue bidding.`;
    addHistory(room, "PASS", passMessage, { playerName: auction.currentPlayer.name, teamId: team.id, memberName: member.name });
    addRoomMessage(room, "PLAYER PASS", passMessage, true);
    const remaining = room.teams.filter((item) => !auction.passedTeamIds.includes(item.id) && canTeamBid(room, item));
    if (remaining.length === 0) {
      if (auction.highestBidTeamId) finishCurrentPlayer(room, true);
      else finishCurrentPlayer(room, false, { reason: "All franchises passed" });
      ackSuccess(ack, { passed: true, remainingFranchises: 0, lotClosed: true });
    } else {
      ackSuccess(ack, { passed: true, remainingFranchises: remaining.length });
      publish(room);
    }
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
    addRoomMessage(room, "ARENA BOT", "The host ended the auction. Final franchise squads are ready.", true);
    saveCompletedAuction(room);
    ackSuccess(ack);
    publish(room);
  });

  socket.on("chat:send", (payload = {}, ack) => {
    const room = getRoomForSocket(socket);
    const member = room && getMember(socket, room);
    const text = String(payload.text || "").trim().slice(0, 240);
    if (!room || !member || !text) return ackError(ack, "Enter a message first.");
    addRoomMessage(room, member.name, text, false);
    ackSuccess(ack);
    publish(room);
  });

  socket.on("room:leave", (_payload, ack) => {
    const room = getRoomForSocket(socket);
    if (!room) return ackSuccess(ack);
    const member = getMember(socket, room);
    if (room.status === "LOBBY" && member && member.teamId) {
      const seatIndex = room.teams.findIndex((item) => item.id === member.teamId);
      if (seatIndex >= 0) resetTeamSlot(room.teams[seatIndex], seatIndex);
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
      addRoomMessage(room, "ARENA BOT", `${member.name} disconnected.`, true);
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
