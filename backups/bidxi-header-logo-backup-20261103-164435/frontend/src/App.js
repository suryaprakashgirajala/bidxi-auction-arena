import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:4000";
const FRANCHISES = [
  { id: "CSK", shortName: "CSK", name: "Chennai Super Kings", color: "#f6c900", logo: "https://upload.wikimedia.org/wikipedia/en/2/2b/Chennai_Super_Kings_Logo.svg" },
  { id: "MI", shortName: "MI", name: "Mumbai Indians", color: "#1685d4", logo: "https://upload.wikimedia.org/wikipedia/en/c/cd/Mumbai_Indians_Logo.svg" },
  { id: "RCB", shortName: "RCB", name: "Royal Challengers Bengaluru", color: "#e53945", logo: "https://upload.wikimedia.org/wikipedia/en/2/2a/Royal_Challengers_Bengaluru_Logo.svg" },
  { id: "KKR", shortName: "KKR", name: "Kolkata Knight Riders", color: "#8e65bd", logo: "https://upload.wikimedia.org/wikipedia/en/4/4c/Kolkata_Knight_Riders_Logo.svg" },
  { id: "SRH", shortName: "SRH", name: "Sunrisers Hyderabad", color: "#f47722", logo: "https://upload.wikimedia.org/wikipedia/en/8/81/Sunrisers_Hyderabad.svg" },
  { id: "RR", shortName: "RR", name: "Rajasthan Royals", color: "#e45b99", logo: "https://upload.wikimedia.org/wikipedia/en/6/60/Rajasthan_Royals_Logo.svg" },
  { id: "DC", shortName: "DC", name: "Delhi Capitals", color: "#2a66b7", logo: "https://upload.wikimedia.org/wikipedia/en/2/2f/Delhi_Capitals.svg" },
  { id: "PBKS", shortName: "PBKS", name: "Punjab Kings", color: "#d83245", logo: "https://upload.wikimedia.org/wikipedia/en/d/d4/Punjab_Kings_Logo.svg" },
  { id: "GT", shortName: "GT", name: "Gujarat Titans", color: "#1b315e", logo: "https://upload.wikimedia.org/wikipedia/en/0/09/Gujarat_Titans_Logo.svg" },
  { id: "LSG", shortName: "LSG", name: "Lucknow Super Giants", color: "#20a6bd", logo: "https://upload.wikimedia.org/wikipedia/en/a/a9/Lucknow_Super_Giants_IPL_Logo.svg" }
];

const DEFAULT_FORM = {
  playerName: "",
  teamCount: 5,
  humanLimit: 3,
  initialPurse: 120,
  restrictionMode: "IPL",
  minSquadSize: 18,
  maxSquadSize: 25,
  maxOverseasPlayers: 8,
  bidIncrement: 0.5,
  timerSeconds: 12,
  botDifficulty: "MEDIUM",
  auctioneerMode: "AUTO",
  roomVisibility: "PRIVATE"
};

const CUSTOM_BADGES = ["★", "⚡", "🛡", "🔥", "🐯", "🦁", "🦅", "👑", "🏏", "💎", "🌪", "⚔"];
const SQUAD_ROLE_GROUPS = [
  { key: "Batter", label: "BATTERS", icon: "🏏" },
  { key: "Bowler", label: "BOWLERS", icon: "🎯" },
  { key: "Wicket Keeper", label: "WICKET KEEPERS", icon: "🧤" },
  { key: "All Rounder", label: "ALL-ROUNDERS", icon: "⚡" }
];
function isOverseasPlayer(player) {
  const nationality = String(player?.nationality || "").trim().toLowerCase();
  return Boolean(nationality && nationality !== "india" && nationality !== "indian");
}
function getOverseasCount(players = []) {
  return players.filter((player) => player.isOverseas === true || isOverseasPlayer(player)).length;
}

function formatCr(value) {
  return `₹${Number(value || 0).toFixed(2)} Cr`;
}
function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function initials(value) {
  return String(value || "? ").split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}
function botPersonalityLabel(personality) {
  const labels = {
    AGGRESSIVE: "AGGRESSIVE",
    DEFENSIVE: "BUDGET CONTROLLER",
    BALANCED: "BALANCED",
    VALUE_HUNTER: "VALUE HUNTER",
    STAR_HUNTER: "STAR HUNTER"
  };
  return labels[personality] || "AI RIVAL";
}

function playerSlug(value) {
  return String(value || "player").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function PlayerPortrait({ player, className = "player-portrait" }) {
  const [source, setSource] = useState(player?.image || "");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setSource(player?.image || "");
    setFailed(false);
  }, [player?.id, player?.image]);
  if (failed || !source) return <span className={`${className} portrait-fallback`}>{initials(player?.name)}</span>;
  return <img className={className} src={source} alt={`${player?.name || "Player"} profile`} onError={() => {
    const fallback = `/player-avatars/${playerSlug(player?.name)}.svg`;
    if (source !== fallback) setSource(fallback);
    else setFailed(true);
  }} />;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"' && quoted && input[index + 1] === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((part) => part !== "")) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some((part) => part !== "")) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows.shift().map((header) => header.toLowerCase().replace(/[^a-z]/g, ""));
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

export default function App() {
  const socketRef = useRef(null);
  const [connection, setConnection] = useState("DISCONNECTED");
  const [authToken, setAuthToken] = useState(() => localStorage.getItem("arena_token") || "");
  const [account, setAccount] = useState(null);
  const [authLoading, setAuthLoading] = useState(Boolean(localStorage.getItem("arena_token")));
  const [authMode, setAuthMode] = useState("LOGIN");
  const [authForm, setAuthForm] = useState({ identifier: "", displayName: "", username: "", email: "", password: "" });
  const [authMessage, setAuthMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [profileData, setProfileData] = useState({ stats: null, auctions: [], loading: false, error: "" });
  const [selectedHistoryId, setSelectedHistoryId] = useState(null);
  const [room, setRoom] = useState(null);
  const [memberId, setMemberId] = useState(null);
  const [screen, setScreen] = useState("HOME");
  const [panel, setPanel] = useState("CREATE");
  const [form, setForm] = useState(DEFAULT_FORM);
  const [teamChoiceMode, setTeamChoiceMode] = useState("IPL");
  const [customTeamForm, setCustomTeamForm] = useState({ name: "", shortName: "", color: "#e0aa43", badge: "★", logo: "" });
  const [theme, setTheme] = useState(() => localStorage.getItem("arena_theme") || "DARK");
  const [joinForm, setJoinForm] = useState({ playerName: "", code: "" });
  const [message, setMessage] = useState("");
  const [chatText, setChatText] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTeam, setActiveTeam] = useState(null);
  const [publicRooms, setPublicRooms] = useState([]);
  const [playerCatalog, setPlayerCatalog] = useState({ players: [], total: 0, builtIn: 0, custom: 0 });
  const [playerCatalogLoading, setPlayerCatalogLoading] = useState(false);
  const [playerCatalogError, setPlayerCatalogError] = useState("");
  const [playerCatalogMessage, setPlayerCatalogMessage] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [playerRoleFilter, setPlayerRoleFilter] = useState("ALL");
  const [playerFormOpen, setPlayerFormOpen] = useState(false);
  const [playerEditingId, setPlayerEditingId] = useState(null);
  const [playerFormBusy, setPlayerFormBusy] = useState(false);
  const [playerFormError, setPlayerFormError] = useState("");
  const [playerForm, setPlayerForm] = useState({ name: "", role: "Batter", nationality: "India", basePrice: "0.30", arenaRating: "70", image: "" });
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (!authToken) {
      setConnection("DISCONNECTED");
      socketRef.current = null;
      return undefined;
    }

    const socket = io(API_URL, {
      auth: { token: authToken },
      transports: ["websocket", "polling"],
      reconnection: true
    });
    socketRef.current = socket;
    socket.on("connect", () => setConnection("CONNECTED"));
    socket.on("disconnect", () => setConnection("DISCONNECTED"));
    socket.on("connect_error", (error) => {
      setConnection("DISCONNECTED");
      if (/expired|invalid session|account not found/i.test(error.message || "")) {
        localStorage.removeItem("arena_token");
        setAuthToken("");
        setAccount(null);
        setAuthMessage("Your session expired. Please log in again.");
      }
    });
    socket.on("room:joined", ({ room: nextRoom, memberId: nextMemberId }) => {
      setMemberId(nextMemberId);
      setRoom(nextRoom);
      setScreen(nextRoom.status === "LIVE" ? "GAME" : nextRoom.status === "REVIEW" ? "REVIEW" : nextRoom.status === "COMPLETED" ? "RESULTS" : "LOBBY");
      setMessage("");
    });
    socket.on("room:state", (nextRoom) => {
      setRoom(nextRoom);
      if (nextRoom.status === "LIVE") setScreen("GAME");
      else if (nextRoom.status === "REVIEW") setScreen("REVIEW");
      else if (nextRoom.status === "COMPLETED") setScreen("RESULTS");
      else setScreen("LOBBY");
    });
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [authToken]);

  useEffect(() => {
    if (!authToken) {
      setAccount(null);
      setAuthLoading(false);
      return undefined;
    }
    let active = true;
    setAuthLoading(true);
    fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Please log in again.");
        if (active) {
          setAccount(data.user);
          setForm((previous) => ({ ...previous, playerName: data.user.displayName }));
          setJoinForm((previous) => ({ ...previous, playerName: data.user.displayName }));
        }
      })
      .catch((error) => {
        if (active) {
          localStorage.removeItem("arena_token");
          setAuthToken("");
          setAccount(null);
          setAuthMessage(error.message);
        }
      })
      .finally(() => { if (active) setAuthLoading(false); });
    return () => { active = false; };
  }, [authToken]);

  useEffect(() => {
    localStorage.setItem("arena_theme", theme);
  }, [theme]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const loadPublicRooms = async () => {
      try {
        const response = await fetch(`${API_URL}/api/rooms`);
        if (!response.ok) return;
        const data = await response.json();
        if (active) setPublicRooms(data);
      } catch (_error) {
        if (active) setPublicRooms([]);
      }
    };
    loadPublicRooms();
    const timer = window.setInterval(loadPublicRooms, 12000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [room?.chat?.length]);

  const submitAuth = async (event) => {
    event.preventDefault();
    setAuthBusy(true);
    setAuthMessage("");
    const isRegister = authMode === "REGISTER";
    const endpoint = isRegister ? "/api/auth/register" : "/api/auth/login";
    const body = isRegister
      ? { displayName: authForm.displayName, username: authForm.username, email: authForm.email, password: authForm.password }
      : { identifier: authForm.identifier, password: authForm.password };
    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to authenticate.");
      localStorage.setItem("arena_token", data.token);
      setAccount(data.user);
      setAuthToken(data.token);
      setForm((previous) => ({ ...previous, playerName: data.user.displayName }));
      setJoinForm((previous) => ({ ...previous, playerName: data.user.displayName }));
      setScreen("HOME");
      setAuthForm({ identifier: "", displayName: "", username: "", email: "", password: "" });
      setAuthMessage("");
    } catch (error) {
      setAuthMessage(error.message || "Unable to authenticate.");
    } finally {
      setAuthBusy(false);
    }
  };

  const logout = async () => {
    if (room) await emit("room:leave");
    localStorage.removeItem("arena_token");
    setAuthToken("");
    setAccount(null);
    setRoom(null);
    setMemberId(null);
    setScreen("HOME");
    setConnection("DISCONNECTED");
    setProfileData({ stats: null, auctions: [], loading: false, error: "" });
  };

  const loadProfile = async () => {
    if (!authToken) return;
    setProfileData((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      const headers = { Authorization: `Bearer ${authToken}` };
      const [historyResponse, statsResponse] = await Promise.all([
        fetch(`${API_URL}/api/me/auctions`, { headers }),
        fetch(`${API_URL}/api/me/stats`, { headers })
      ]);
      const [history, stats] = await Promise.all([historyResponse.json(), statsResponse.json()]);
      if (!historyResponse.ok) throw new Error(history.error || "Unable to load auction history.");
      if (!statsResponse.ok) throw new Error(stats.error || "Unable to load account statistics.");
      setProfileData({ stats, auctions: history.auctions || [], loading: false, error: "" });
    } catch (error) {
      setProfileData((previous) => ({ ...previous, loading: false, error: error.message }));
    }
  };

  const updateProfileName = async (displayName) => {
    const response = await fetch(`${API_URL}/api/auth/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ displayName })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Unable to update profile.");
    setAccount(data.user);
    if (data.token) {
      localStorage.setItem("arena_token", data.token);
      setAuthToken(data.token);
    }
    setForm((previous) => ({ ...previous, playerName: data.user.displayName }));
    setJoinForm((previous) => ({ ...previous, playerName: data.user.displayName }));
    return data.user;
  };

  const emit = useCallback((event, payload = {}) => new Promise((resolve) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      resolve({ ok: false, error: "Not connected to the game server. Check that the backend is running." });
      return;
    }
    socket.emit(event, payload, (response) => resolve(response || { ok: false, error: "No response from server." }));
  }), []);

  const updateForm = (key, value) => {
    setForm((previous) => {
      const next = { ...previous, [key]: value };
      if (key === "teamCount") next.humanLimit = Math.min(Number(next.humanLimit), Number(value));
      if (key === "humanLimit") next.humanLimit = Math.min(Number(value), Number(previous.teamCount));
      if (key === "restrictionMode" && value === "IPL") {
        next.minSquadSize = 18;
        next.maxSquadSize = 25;
        next.maxOverseasPlayers = 8;
      }
      if (key === "restrictionMode" && value === "NONE") {
        next.minSquadSize = 0;
        next.maxSquadSize = 263;
        next.maxOverseasPlayers = 263;
      }
      if (key === "maxSquadSize") {
        next.minSquadSize = Math.min(Number(next.minSquadSize), Number(value));
        next.maxOverseasPlayers = Math.min(Number(next.maxOverseasPlayers), Number(value));
      }
      if (key === "minSquadSize") next.minSquadSize = Math.min(Number(value), Number(next.maxSquadSize));
      if (key === "maxOverseasPlayers") next.maxOverseasPlayers = Math.min(Number(value), Number(next.maxSquadSize));
      return next;
    });
  };


  const createRoom = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const result = await emit("room:create", {
      playerName: form.playerName,
      settings: {
        teamCount: Number(form.teamCount), humanLimit: Number(form.humanLimit),
        initialPurse: Number(form.initialPurse), restrictionMode: form.restrictionMode,
        minSquadSize: Number(form.minSquadSize), maxSquadSize: Number(form.maxSquadSize),
        maxOverseasPlayers: Number(form.maxOverseasPlayers),
        bidIncrement: Number(form.bidIncrement), timerSeconds: Number(form.timerSeconds),
        botDifficulty: form.botDifficulty, auctioneerMode: form.auctioneerMode,
        roomVisibility: form.roomVisibility
      }
    });
    setBusy(false);
    if (!result.ok) setMessage(result.error);
    else {
      setRoom(result.room);
      setMemberId(result.memberId);
      setScreen("LOBBY");
    }
  };

  const joinRoom = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const result = await emit("room:join", { playerName: joinForm.playerName, code: joinForm.code });
    setBusy(false);
    if (!result.ok) setMessage(result.error);
    else {
      setRoom(result.room);
      setMemberId(result.memberId);
      setScreen("LOBBY");
    }
  };

  const chooseTeam = async (teamId) => {
    setMessage("");
    const result = await emit("team:select", { type: "IPL", teamId });
    if (!result.ok) setMessage(result.error);
  };

  const chooseCustomTeam = async (event) => {
    event.preventDefault();
    setMessage("");
    const result = await emit("team:select", { type: "CUSTOM", ...customTeamForm });
    if (!result.ok) setMessage(result.error);
  };

  const unselectTeam = async () => {
    const result = await emit("team:unselect");
    if (!result.ok) setMessage(result.error);
  };

  const startAuction = async () => {
    setBusy(true);
    const result = await emit("room:start");
    setBusy(false);
    if (!result.ok) setMessage(result.error);
    else if (result.room) { setRoom(result.room); setScreen(result.room.status === "REVIEW" ? "REVIEW" : "LOBBY"); }
  };

  const confirmPlayerPool = async () => {
    setBusy(true);
    setMessage("");
    const result = await emit("auction:poolConfirm");
    setBusy(false);
    if (!result.ok) setMessage(result.error);
    else setPlayerCatalogMessage(result.allConfirmed ? "Everyone confirmed. The auction is starting!" : "Your player-pool confirmation has been recorded.");
  };

  const placeBid = async () => {
    setBusy(true);
    const result = await emit("auction:bid");
    setBusy(false);
    if (!result.ok) setMessage(result.error);
  };

  const auctioneerDecision = async (result) => {
    setBusy(true);
    const response = await emit("auction:finalize", { result });
    setBusy(false);
    if (!response.ok) setMessage(response.error);
  };

  const toggleAuctionPause = async () => {
    setBusy(true);
    setMessage("");
    const eventName = room?.auction?.paused ? "auction:resume" : "auction:pause";
    const response = await emit(eventName);
    setBusy(false);
    if (!response.ok) setMessage(response.error);
  };

  const passOnPlayer = async () => {
    if (!currentPlayer || !myTeam) return;
    if (!window.confirm(`Pass on ${currentPlayer.name}? Your franchise will not be able to bid on this player, but the auction will continue for everyone else.`)) return;
    setBusy(true);
    setMessage("");
    const response = await emit("auction:pass");
    setBusy(false);
    if (!response.ok) setMessage(response.error);
  };

  const endAuction = async () => {
    if (!window.confirm("End this auction now? All current franchise squads will be shown to every participant.")) return;
    setBusy(true);
    setMessage("");
    const response = await emit("room:end");
    setBusy(false);
    if (!response.ok) setMessage(response.error);
  };

  const sendChat = async (event) => {
    event.preventDefault();
    const text = chatText.trim();
    if (!text) return;
    const result = await emit("chat:send", { text });
    if (!result.ok) setMessage(result.error);
    else setChatText("");
  };

  const leaveRoom = async () => {
    await emit("room:leave");
    setRoom(null);
    setMemberId(null);
    setScreen("HOME");
    setMessage("");
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (_error) {
      setCopied(false);
      setMessage(`Share this room code with your friends: ${room.code}`);
    }
  };

  const apiHeaders = () => ({ Authorization: `Bearer ${authToken}` });

  const loadPlayerCatalog = async () => {
    setPlayerCatalogLoading(true);
    setPlayerCatalogError("");
    try {
      const response = await fetch(`${API_URL}/api/players`, { headers: apiHeaders() });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to load the player catalogue.");
      setPlayerCatalog({ players: data.players || [], total: data.total || 0, builtIn: data.builtIn || 0, custom: data.custom || 0 });
    } catch (error) {
      setPlayerCatalogError(error.message || "Unable to load players.");
    } finally {
      setPlayerCatalogLoading(false);
    }
  };

  const openPlayerManager = () => {
    setScreen("PLAYERS");
    setPlayerCatalogMessage("");
    setPlayerFormOpen(false);
    loadPlayerCatalog();
  };

  const loadAnalytics = async () => {
    setAnalyticsLoading(true);
    setAnalyticsError("");
    try {
      const response = await fetch(`${API_URL}/api/analytics/overview`, { headers: apiHeaders() });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to load analytics.");
      setAnalyticsData(data);
    } catch (error) {
      setAnalyticsError(error.message || "Unable to load analytics.");
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const openAnalytics = () => {
    setScreen("ANALYTICS");
    loadAnalytics();
  };

  const resetPlayerForm = () => {
    setPlayerForm({ name: "", role: "Batter", nationality: "India", basePrice: "0.30", arenaRating: "70", image: "" });
    setPlayerEditingId(null);
    setPlayerFormError("");
    setPlayerFormOpen(false);
  };

  const savePlayer = async (event) => {
    event.preventDefault();
    setPlayerFormBusy(true);
    setPlayerFormError("");
    try {
      const response = await fetch(`${API_URL}/api/players${playerEditingId ? `/${encodeURIComponent(playerEditingId)}` : ""}`, {
        method: playerEditingId ? "PATCH" : "POST",
        headers: { ...apiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ...playerForm, basePrice: Number(playerForm.basePrice), arenaRating: Number(playerForm.arenaRating) })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to save player.");
      setPlayerCatalogMessage(playerEditingId ? `${data.player.name} updated.` : `${data.player.name} added to your player pool.`);
      resetPlayerForm();
      await loadPlayerCatalog();
    } catch (error) {
      setPlayerFormError(error.message || "Unable to save player.");
    } finally {
      setPlayerFormBusy(false);
    }
  };

  const editPlayer = (player) => {
    setPlayerEditingId(player.id);
    setPlayerForm({ name: player.name, role: player.role, nationality: player.nationality || "India", basePrice: String(player.basePrice), arenaRating: String(player.arenaRating || 70), image: player.image || "" });
    setPlayerFormError("");
    setPlayerFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deletePlayer = async (player) => {
    if (!window.confirm(`Remove ${player.name} from your personal player pool? Built-in players cannot be deleted.`)) return;
    try {
      const response = await fetch(`${API_URL}/api/players/${encodeURIComponent(player.id)}`, { method: "DELETE", headers: apiHeaders() });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to remove player.");
      setPlayerCatalogMessage(`${player.name} removed from your player pool.`);
      await loadPlayerCatalog();
    } catch (error) {
      setPlayerCatalogError(error.message || "Unable to remove player.");
    }
  };

  const uploadPlayerImage = (file) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 600 * 1024) {
      setPlayerFormError("Choose a PNG, JPG or WEBP image up to 600 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPlayerForm((previous) => ({ ...previous, image: String(reader.result || "") }));
    reader.onerror = () => setPlayerFormError("Unable to read that image. Try another file.");
    reader.readAsDataURL(file);
  };

  const importPlayerCsv = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 1024 * 1024) { setPlayerCatalogError("CSV file must be smaller than 1 MB."); return; }
    try {
      const parsed = parseCsvRows(await file.text());
      if (!parsed.length) throw new Error("CSV contains no player rows. Use the downloadable CSV template.");
      const players = parsed.slice(0, 250).map((row) => ({
        name: row.name,
        role: row.role,
        nationality: row.nationality || "India",
        basePrice: Number(row.baseprice || row.base_price || 0.3),
        arenaRating: Number(row.arenarating || row.rating || 70),
        image: row.image || ""
      }));
      const response = await fetch(`${API_URL}/api/players/import`, { method: "POST", headers: { ...apiHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ players }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "CSV import failed.");
      setPlayerCatalogMessage(`Imported ${data.imported} players. ${data.skipped} duplicate rows skipped.`);
      await loadPlayerCatalog();
    } catch (error) {
      setPlayerCatalogError(error.message || "Unable to import CSV.");
    }
  };

  const exportPlayerCatalog = () => {
    const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const lines = [["name", "role", "nationality", "basePrice", "arenaRating", "image"], ...playerCatalog.players.map((player) => [player.name, player.role, player.nationality, player.basePrice, player.arenaRating, player.image])];
    const csv = lines.map((line) => line.map(quote).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "ipl-arena-player-pool.csv"; link.click(); URL.revokeObjectURL(url);
  };

  const myMember = useMemo(() => room?.members?.find((member) => member.id === memberId), [room, memberId]);
  const myTeam = useMemo(() => room?.teams?.find((team) => team.id === myMember?.teamId), [room, myMember]);
  const isHost = Boolean(room && memberId && room.hostMemberId === memberId);
  const isCreator = Boolean(room && memberId && (room.creatorMemberId || room.hostMemberId) === memberId);
  const currentPlayer = room?.auction?.currentPlayer;
  const highestTeam = room?.teams?.find((team) => team.id === room?.auction?.highestBidTeamId);
  const nextBid = currentPlayer ? (room.auction.currentBid > 0 ? room.auction.currentBid + room.settings.bidIncrement : currentPlayer.basePrice) : 0;
  const secondsLeft = room?.auction?.paused
    ? Math.max(0, Math.ceil((Number(room.auction.pausedRemainingMs) || 0) / 1000))
    : room?.auction?.bidExpiresAt ? Math.max(0, Math.ceil((room.auction.bidExpiresAt - clock) / 1000)) : 0;
  const myTeamPassed = Boolean(myTeam && (room?.auction?.passedTeamIds || []).includes(myTeam.id));
  const myOverseasCount = myTeam ? getOverseasCount(myTeam.players) : 0;
  const myOverseasLimitReached = Boolean(myTeam && currentPlayer && isOverseasPlayer(currentPlayer) && myOverseasCount >= Number(room?.settings?.maxOverseasPlayers ?? 263));
  const myTurnToBid = Boolean(myTeam && !myTeamPassed && !myOverseasLimitReached && room?.status === "LIVE" && room?.auction && !room.auction.paused && !room.auction.waitingForDecision && room.auction.highestBidTeamId !== myTeam.id && secondsLeft > 0 && myTeam.purse >= nextBid && myTeam.players.length < room.settings.maxSquadSize);
  const botCount = room ? room.teams.filter((team) => team.ownerType === "BOT").length : 0;
  const humanCount = room ? room.members.filter((member) => member.connected).length : 0;

  const renderHeader = () => (
    <header className="topbar">
      <div className="brand bidxi-brand" role="button" tabIndex={0} aria-label="BIDXI home" onClick={() => room ? leaveRoom() : setScreen("HOME")} onKeyDown={(event) => event.key === "Enter" && (room ? leaveRoom() : setScreen("HOME"))}>
        <img className="brand-logo" src="/brand/bidxi-header.png" alt="BIDXI — Build Your XI. Own the Game." />
      </div>
      <div className="topbar-right">
        <span className={`connection-pill ${connection === "CONNECTED" ? "online" : "offline"}`}><i />{authLoading ? "RESTORING SESSION" : !account ? "LOGIN REQUIRED" : connection === "CONNECTED" ? "SERVER ONLINE" : connection === "CONNECTING" ? "CONNECTING" : "SERVER OFFLINE"}</span>
        {room && <span className="room-chip">ROOM <b>{room.code}</b></span>}
        <button type="button" className="theme-toggle" onClick={() => setTheme((value) => value === "DARK" ? "LIGHT" : "DARK")} aria-label="Toggle background theme">{theme === "DARK" ? "☀ LIGHT MODE" : "☾ DARK MODE"}</button>
        {account && !room && <><button className={`account-nav ${screen === "PLAYERS" ? "active" : ""}`} onClick={openPlayerManager}>PLAYER POOL</button><button className={`account-nav ${screen === "ANALYTICS" ? "active" : ""}`} onClick={openAnalytics}>ANALYTICS</button><button className={`account-nav ${screen === "PROFILE" ? "active" : ""}`} onClick={() => { setScreen("PROFILE"); loadProfile(); }}>MY ACCOUNT</button></>}
        {account && <><span className="account-name">{account.displayName}</span><button className="logout-button" onClick={logout}>LOG OUT</button></>}
      </div>
    </header>
  );

  const renderAuth = () => (
    <main className="auth-wrap">
      <section className="auth-card">
        <div className="bidxi-auth-logo"><img src="/brand/bidxi-lockup.png" alt="BIDXI — Build Your XI. Own the Game." /></div>
        <div className="eyebrow"><span className="eyebrow-dot" /> YOUR SEAT IN THE ARENA</div>
        <h1>{authMode === "LOGIN" ? <>WELCOME <span>BACK.</span></> : <>CREATE YOUR <span>ACCOUNT.</span></>}</h1>
        <p className="auth-intro">Sign in to create auctions, join your friends and keep your franchise history saved to your account.</p>
        <div className="auth-tabs">
          <button type="button" className={authMode === "LOGIN" ? "active" : ""} onClick={() => { setAuthMode("LOGIN"); setAuthMessage(""); }}>LOG IN</button>
          <button type="button" className={authMode === "REGISTER" ? "active" : ""} onClick={() => { setAuthMode("REGISTER"); setAuthMessage(""); }}>CREATE ACCOUNT</button>
        </div>
        <form onSubmit={submitAuth} className="auth-form">
          {authMode === "REGISTER" ? <>
            <label>Display name<input required minLength="2" maxLength="24" value={authForm.displayName} onChange={(e) => setAuthForm({ ...authForm, displayName: e.target.value })} placeholder="e.g. Surya" autoComplete="nickname" /></label>
            <label>Username<input required minLength="3" maxLength="20" pattern="[A-Za-z0-9_]+" value={authForm.username} onChange={(e) => setAuthForm({ ...authForm, username: e.target.value })} placeholder="e.g. surya_ipl" autoComplete="username" /></label>
            <label>Email address<input required type="email" maxLength="254" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} placeholder="you@example.com" autoComplete="email" /></label>
          </> : <label>Email or username<input required value={authForm.identifier} onChange={(e) => setAuthForm({ ...authForm, identifier: e.target.value })} placeholder="Email address or username" autoComplete="username" /></label>}
          <label>Password<input required type="password" minLength="8" maxLength="128" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} placeholder="At least 8 characters" autoComplete={authMode === "LOGIN" ? "current-password" : "new-password"} /></label>
          {authMessage && <div className="inline-alert auth-alert" role="alert">{authMessage}</div>}
          <button className="btn btn-primary form-submit" type="submit" disabled={authBusy}>{authBusy ? "PLEASE WAIT..." : authMode === "LOGIN" ? "LOG IN TO THE ARENA" : "CREATE MY ACCOUNT"}<span>→</span></button>
        </form>
        <div className="auth-footnote">Your password is stored as a salted password hash, never as plain text.</div>
      </section>
    </main>
  );

  const renderProfile = () => {
    const selectedAuction = profileData.auctions.find((auction) => auction.id === selectedHistoryId);
    const myTeam = selectedAuction?.teams?.find((team) => team.id === selectedAuction.myTeamId);
    return (
      <main className="workspace profile-workspace">
        <div className="workspace-heading"><div><span className="eyebrow">PLAYER ACCOUNT</span><h1>MY <span>ARENA.</span></h1><p>Manage your profile and revisit completed auctions.</p></div><button className="btn btn-ghost" onClick={() => setScreen("HOME")}>BACK TO ARENA</button></div>
        <section className="profile-card panel-box">
          <div className="profile-avatar">{initials(account?.displayName)}</div>
          <div className="profile-details"><span className="eyebrow">ACCOUNT PROFILE</span><h2>{account?.displayName}</h2><p>@{account?.username} · {account?.email}</p><small>Member since {account?.createdAt ? new Date(account.createdAt).toLocaleDateString() : "today"}</small></div>
          <button className="btn btn-outline btn-small" onClick={async () => { const next = window.prompt("Enter your new display name", account?.displayName || ""); if (next !== null) { try { await updateProfileName(next); } catch (error) { setProfileData((previous) => ({ ...previous, error: error.message })); } } }}>EDIT DISPLAY NAME</button>
        </section>
        <div className="profile-stats">
          <div className="panel-box"><b>{profileData.stats?.auctionsPlayed ?? "—"}</b><span>AUCTIONS PLAYED</span></div>
          <div className="panel-box"><b>{profileData.stats?.teamsManaged ?? "—"}</b><span>FRANCHISES MANAGED</span></div>
          <div className="panel-box"><b>{profileData.auctions.length}</b><span>ARCHIVED RESULTS</span></div>
        </div>
        <section className="panel-box profile-history">
          <div className="panel-heading"><div><span className="eyebrow">YOUR GAME RECORD</span><h2>Auction history</h2></div><button className="btn btn-ghost btn-small" onClick={loadProfile}>REFRESH</button></div>
          {profileData.loading ? <p className="profile-empty">Loading your account history...</p> : profileData.error ? <p className="profile-empty error-text">{profileData.error}</p> : profileData.auctions.length === 0 ? <p className="profile-empty">No completed auctions yet. Finish your first auction and it will appear here.</p> : <div className="history-list">{profileData.auctions.map((auction) => <button className={`history-row ${selectedHistoryId === auction.id ? "selected" : ""}`} key={auction.id} onClick={() => setSelectedHistoryId(selectedHistoryId === auction.id ? null : auction.id)}><span><b>ROOM {auction.roomCode}</b><small>{auction.teamCount} franchises · {new Date(auction.completedAt).toLocaleString()}</small></span><span><b>{auction.myTeamName}</b><small>{auction.soldCount}/{auction.playerCount} players sold overall</small></span><strong>₹{Number(auction.teams.find((team) => team.id === auction.myTeamId)?.spent || 0).toFixed(2)} Cr spent</strong></button>)}</div>}
        </section>
        {selectedAuction && myTeam && <section className="panel-box profile-history"><div className="panel-heading"><div><span className="eyebrow">YOUR SAVED FRANCHISE</span><h2>{myTeam.name}</h2></div><span className="spent-total">₹{Number(myTeam.spent).toFixed(2)} Cr spent</span></div><div className="profile-squad-list">{myTeam.players.length ? myTeam.players.map((player) => <div key={player.id}><span>{player.name}<small>{player.role}</small></span><b>₹{Number(player.finalPrice).toFixed(2)} Cr</b></div>) : <p>No players were purchased by this franchise.</p>}</div></section>}
      </main>
    );
  };

  const renderHome = () => (
    <main className="home-wrap">
      <section className="hero-grid">
        <div className="hero-copy">
          <div className="bidxi-home-logo"><img src="/brand/bidxi-header.png" alt="BIDXI cricket auction arena" /></div>
          <div className="eyebrow"><span className="eyebrow-dot" /> THE ULTIMATE CRICKET AUCTION GAME</div>
          <h1>BUILD YOUR<br /><span>CHAMPION XI.</span></h1>
          <p className="hero-lede">Your friends. Your franchise. Your strategy. Enter a live cricket auction where every bid can change your season.</p>
          <div className="hero-actions">
            <button className="btn btn-primary btn-large" onClick={() => { setPanel("CREATE"); setMessage(""); }}>CREATE AUCTION <span>↗</span></button>
            <button className="btn btn-outline btn-large" onClick={() => { setPanel("JOIN"); setMessage(""); }}>JOIN WITH CODE</button>
          </div>
          <div className="hero-proof"><span>●</span> PLAY SOLO OR WITH FRIENDS <i /> AI FRANCHISES FILL THE REST</div>
        </div>
        <div className="hero-art" aria-label="Cricket stadium illustration">
          <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
          <div className="stadium-glow" />
          <div className="hero-ball"><span>IPL</span></div>
          <div className="hero-tag tag-top">LIVE BIDDING</div>
          <div className="hero-tag tag-bottom">AI RIVALS ONLINE</div>
          <div className="art-stat stat-left"><b>10</b><span>MAX TEAMS</span></div>
          <div className="art-stat stat-right"><b>260+</b><span>PLAYERS</span></div>
        </div>
      </section>

      <section className="feature-strip">
        <div><span className="feature-icon">◈</span><b>REAL-TIME AUCTION</b><small>Every bid updates live</small></div>
        <div><span className="feature-icon">✦</span><b>SMART AI RIVALS</b><small>Strategic bot franchises</small></div>
        <div><span className="feature-icon">♜</span><b>FLEXIBLE TEAMS</b><small>Choose 2 to 10 franchises</small></div>
        <div><span className="feature-icon">⌂</span><b>PRIVATE ROOMS</b><small>Invite friends with a code</small></div>
      </section>

      <section className="management-launchers">
        <button className="panel-box management-launch-card" onClick={openPlayerManager}><span className="management-launch-icon">♟</span><span><b>PLAYER MANAGEMENT</b><small>Browse 263 player profiles · add and import players</small></span><i>→</i></button>
        <button className="panel-box management-launch-card" onClick={openAnalytics}><span className="management-launch-icon">◫</span><span><b>AUCTION ANALYTICS</b><small>Explore spending, top purchases and auction trends</small></span><i>→</i></button>
      </section>

      <section className="entry-section">
        <div className="section-heading"><div><span className="eyebrow">GET INTO THE ARENA</span><h2>How do you want to play?</h2></div><span className="muted-note">No fixed team count. You decide.</span></div>
        <div className="entry-grid">
          <div className={`entry-card ${panel === "CREATE" ? "selected" : ""}`}>
            <div className="entry-card-head"><span className="entry-number">01</span><span className="entry-icon">＋</span></div>
            <h3>Create an auction</h3>
            <p>Set the rules, choose how many franchises you want and invite your friends. AI takes every unclaimed team.</p>
            <button className="text-action" onClick={() => { setPanel("CREATE"); setMessage(""); }}>SET UP A ROOM <span>→</span></button>
          </div>
          <div className={`entry-card ${panel === "JOIN" ? "selected" : ""}`}>
            <div className="entry-card-head"><span className="entry-number">02</span><span className="entry-icon">↗</span></div>
            <h3>Join a friend's room</h3>
            <p>Have a room code? Enter it, claim your franchise and get ready to outbid everyone.</p>
            <button className="text-action" onClick={() => { setPanel("JOIN"); setMessage(""); }}>ENTER ROOM CODE <span>→</span></button>
          </div>
          <div className="setup-card">
            {panel === "CREATE" ? (
              <form onSubmit={createRoom}>
                <div className="form-title"><span className="live-dot" /> NEW PRIVATE ARENA</div>
                <label>Your display name<input required maxLength="24" value={account?.displayName || form.playerName} readOnly aria-readonly="true" /></label>
                <div className="form-row">
                  <label>Total franchises<select value={form.teamCount} onChange={(e) => updateForm("teamCount", Number(e.target.value))}>{Array.from({ length: 9 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n} teams</option>)}</select></label>
                  <label>Max human players<select value={form.humanLimit} onChange={(e) => updateForm("humanLimit", Number(e.target.value))}>{Array.from({ length: Number(form.teamCount) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} {n === 1 ? "player" : "players"}</option>)}</select></label>
                </div>
                <div className="bot-preview"><span>AI FRANCHISES</span><b>{Math.max(0, Number(form.teamCount) - Number(form.humanLimit))}</b><small>minimum bots; every unclaimed seat becomes an AI rival</small></div>
                <div className="creator-note"><span>✦</span><div><b>EVERY PARTICIPANT PICKS THEIR OWN FRANCHISE</b><small>After entering the lobby, each person can choose an official IPL team or build a custom franchise. Your room settings only control the number of team seats.</small></div></div>
                <label>Team purse<select value={form.initialPurse} onChange={(e) => updateForm("initialPurse", Number(e.target.value))}><option value="80">₹80 Cr</option><option value="100">₹100 Cr</option><option value="120">₹120 Cr</option><option value="150">₹150 Cr</option><option value="200">₹200 Cr</option></select></label>
                <section className="restriction-setup" aria-label="Auction squad restrictions">
                  <div className="restriction-setup-heading"><div><span className="eyebrow">SQUAD RULES</span><h3>How strict should this auction be?</h3></div><span className="rules-shield">⚖</span></div>
                  <label>Restriction profile<select value={form.restrictionMode} onChange={(e) => updateForm("restrictionMode", e.target.value)}><option value="IPL">IPL standard restrictions</option><option value="NONE">No squad restrictions</option><option value="CUSTOM">Customize restrictions</option></select></label>
                  {form.restrictionMode === "IPL" && <div className="restriction-preview"><div><b>18</b><span>MINIMUM TARGET</span></div><div><b>25</b><span>MAX SQUAD</span></div><div><b>8</b><span>OVERSEAS MAX</span></div><small>IPL-style squad limits will apply to every human and AI franchise.</small></div>}
                  {form.restrictionMode === "NONE" && <div className="restriction-preview unrestricted"><div><b>—</b><span>MINIMUM</span></div><div><b>263</b><span>PLAYER POOL CEILING</span></div><div><b>—</b><span>OVERSEAS CAP</span></div><small>Squads can buy any number of players up to the available player pool. Budget rules still apply.</small></div>}
                  {form.restrictionMode === "CUSTOM" && <div className="custom-rule-fields">
                    <label>Minimum squad target<input type="number" min="0" max={form.maxSquadSize} value={form.minSquadSize} onChange={(e) => updateForm("minSquadSize", Number(e.target.value))} /></label>
                    <label>Maximum squad size<input type="number" min="1" max="263" value={form.maxSquadSize} onChange={(e) => updateForm("maxSquadSize", Number(e.target.value))} /></label>
                    <label>Maximum overseas players<input type="number" min="0" max={form.maxSquadSize} value={form.maxOverseasPlayers} onChange={(e) => updateForm("maxOverseasPlayers", Number(e.target.value))} /></label>
                    <small>Maximum squad and overseas limits are enforced during bidding. Minimum squad is a target shown in team compliance.</small>
                  </div>}
                  {form.restrictionMode !== "NONE" && Number(form.teamCount) * Number(form.minSquadSize) > 263 && <div className="rule-capacity-warning">⚠ The current player pool has 263 players, but {form.teamCount} teams × {form.minSquadSize} minimum players requires {Number(form.teamCount) * Number(form.minSquadSize)} players. The auction can still run; any minimum-squad shortfall will be shown in the final results.</div>}
                  {form.restrictionMode !== "NONE" && form.restrictionMode !== "IPL" && <small className="rule-note">Minimum squad size is a completion target. The auction can finish below that target if too few players remain or teams choose not to buy more.</small>}
                </section>
                <div className="form-row">
                  <label>AI difficulty<select value={form.botDifficulty} onChange={(e) => updateForm("botDifficulty", e.target.value)}><option value="EASY">Easy</option><option value="MEDIUM">Medium</option><option value="HARD">Hard</option></select></label>
                  <label>Auctioneer<select value={form.auctioneerMode} onChange={(e) => updateForm("auctioneerMode", e.target.value)}><option value="AUTO">Automatic</option><option value="MANUAL">Manual host</option></select></label>
                </div>
                <div className="form-row compact-row">
                  <label>Bid increment<select value={form.bidIncrement} onChange={(e) => updateForm("bidIncrement", Number(e.target.value))}><option value="0.25">₹0.25 Cr</option><option value="0.5">₹0.50 Cr</option><option value="1">₹1 Cr</option><option value="2">₹2 Cr</option></select></label>
                  <label>Bid timer<select value={form.timerSeconds} onChange={(e) => updateForm("timerSeconds", Number(e.target.value))}><option value="8">8 seconds</option><option value="12">12 seconds</option><option value="15">15 seconds</option><option value="20">20 seconds</option></select></label>
                </div>
                <label>Room visibility<select value={form.roomVisibility} onChange={(e) => updateForm("roomVisibility", e.target.value)}><option value="PRIVATE">Private · invite code</option><option value="PUBLIC">Public · discoverable</option></select></label>
                <button className="btn btn-primary form-submit" type="submit" disabled={busy || connection !== "CONNECTED"}>{busy ? "CREATING..." : "CREATE ROOM & ENTER LOBBY"}<span>→</span></button>
              </form>
            ) : (
              <form onSubmit={joinRoom}>
                <div className="form-title"><span className="live-dot" /> JOIN AN EXISTING ARENA</div>
                <label>Joining as<input value={account?.displayName || ""} readOnly aria-readonly="true" /></label>
                <label>Six-character room code<input required maxLength="6" className="code-input" value={joinForm.code} onChange={(e) => setJoinForm({ ...joinForm, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} placeholder="E.G. 7KPL2A" /></label>
                <div className="join-help">Ask your friend to share the room code shown in their lobby.</div>
                <button className="btn btn-primary form-submit" type="submit" disabled={busy || connection !== "CONNECTED"}>{busy ? "JOINING..." : "JOIN AUCTION ROOM"}<span>→</span></button>
              </form>
            )}
            {message && <div className="inline-alert" role="alert">{message}</div>}
            {connection !== "CONNECTED" && <div className="inline-alert warning">Start the backend server to create or join rooms.</div>}
          </div>
        </div>
        <section className="public-rooms">
          <div className="public-rooms-heading"><div><span className="eyebrow">OPEN MATCHMAKING</span><h3>Public arenas</h3></div><span>{publicRooms.length} LOBBIES OPEN</span></div>
          {publicRooms.length ? <div className="public-room-list">{publicRooms.map((openRoom) => <div className="public-room-row" key={openRoom.code}><div><b>{openRoom.code}</b><small>{openRoom.teamCount} franchises · {openRoom.humans} joined</small></div><button className="text-action" onClick={() => { setJoinForm({ ...joinForm, code: openRoom.code }); setPanel("JOIN"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>JOIN ROOM →</button></div>)}</div> : <div className="no-public-rooms">No public lobbies are open right now. Create one and set visibility to Public to let other players discover it.</div>}
        </section>
      </section>
      <footer className="page-footer"><span>IPL AUCTION ARENA</span><span>BUILT FOR THE LOVE OF THE GAME.</span><span>263 PLAYER POOL · 10 FRANCHISE OPTIONS</span></footer>
    </main>
  );

  const renderLobby = () => {
    const connectedMembers = room.members.filter((member) => member.connected);
    const readyMembers = connectedMembers.filter((member) => Boolean(member.teamId));
    const allParticipantsReady = connectedMembers.length > 0 && readyMembers.length === connectedMembers.length;
    const usedOfficialIds = new Set(room.teams.filter((team) => team.ownerId && team.catalogId).map((team) => team.catalogId));
    const mySelectedTeam = room.teams.find((team) => team.ownerId === memberId);
    const claimedTeams = room.teams.filter((team) => team.ownerId);
    const botSeatsAfterStart = Math.max(0, room.settings.teamCount - connectedMembers.length);

    return (
      <main className="workspace lobby-workspace">
        <div className="workspace-heading">
          <div><span className="eyebrow">PRE-AUCTION DRAFT ROOM</span><h1>Choose your <span>franchise.</span></h1><p>Every participant makes their own choice. Pick an official IPL team or create a custom franchise identity.</p></div>
          <button className="btn btn-ghost" onClick={leaveRoom}>LEAVE ROOM</button>
        </div>
        <section className="lobby-banner lobby-banner-v4">
          <div><span className="mini-label">YOUR PRIVATE ROOM CODE</span><strong className="room-code">{room.code}</strong><small>Share this code with friends. The host starts once everyone currently in the room has selected a franchise.</small></div>
          <button className="btn btn-primary" onClick={copyCode}>{copied ? "COPIED ✓" : "COPY INVITE CODE"}</button>
          <div className="lobby-counts"><div><b>{connectedMembers.length}/{room.settings.humanLimit}</b><span>PLAYERS IN ROOM</span></div><div><b>{readyMembers.length}/{connectedMembers.length}</b><span>TEAMS SELECTED</span></div><div><b>{botSeatsAfterStart}</b><span>AI RIVALS</span></div></div>
        </section>

        <div className="lobby-layout lobby-layout-v4">
          <section className="panel-box franchise-selection-panel">
            <div className="panel-heading"><div><span className="eyebrow">YOUR FRANCHISE IDENTITY</span><h2>{mySelectedTeam ? "Your selection is locked in" : "How do you want to play?"}</h2></div><span className="muted-note">{room.settings.teamCount} total seats in this auction</span></div>

            {mySelectedTeam ? (
              <div className="chosen-franchise-card" style={{ "--team-color": mySelectedTeam.color }}>
                <div className="chosen-emblem">{mySelectedTeam.logo ? <img src={mySelectedTeam.logo} alt="" /> : mySelectedTeam.badge || initials(mySelectedTeam.shortName)}</div>
                <div><small>YOUR FRANCHISE · {mySelectedTeam.isCustom ? "CUSTOM TEAM" : "OFFICIAL IPL TEAM"}</small><h3>{mySelectedTeam.name}</h3><p>{mySelectedTeam.shortName} · Owned by {mySelectedTeam.ownerName}</p></div>
                <button type="button" className="btn btn-outline change-team-btn" onClick={unselectTeam}>CHANGE TEAM</button>
              </div>
            ) : (
              <>
                <div className="franchise-choice-tabs">
                  <button type="button" className={teamChoiceMode === "IPL" ? "active" : ""} onClick={() => { setTeamChoiceMode("IPL"); setMessage(""); }}>🏆 OFFICIAL IPL FRANCHISE</button>
                  <button type="button" className={teamChoiceMode === "CUSTOM" ? "active" : ""} onClick={() => { setTeamChoiceMode("CUSTOM"); setMessage(""); }}>✦ BUILD A CUSTOM TEAM</button>
                </div>
                {teamChoiceMode === "IPL" ? (
                  <>
                    <p className="selection-helper">Choose your favourite franchise. Every official IPL team can be selected by only one participant in this room.</p>
                    <div className="franchise-grid official-franchise-grid">
                      {FRANCHISES.map((franchise) => {
                        const taken = usedOfficialIds.has(franchise.id);
                        const selectedOwner = room.teams.find((team) => team.catalogId === franchise.id && team.ownerId);
                        return <button type="button" key={franchise.id} className={`franchise-card ${taken ? "taken" : ""}`} style={{ "--team-color": franchise.color }} disabled={taken || busy} onClick={() => chooseTeam(franchise.id)}>
                          <img src={franchise.logo} alt={`${franchise.name} logo`} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                          <b>{franchise.shortName}</b><span>{franchise.name}</span>
                          <small>{taken ? `SELECTED BY ${selectedOwner?.ownerName || "ANOTHER PLAYER"}` : "AVAILABLE · SELECT TEAM"}</small>
                        </button>;
                      })}
                    </div>
                  </>
                ) : (
                  <form className="custom-franchise-form" onSubmit={chooseCustomTeam}>
                    <p className="selection-helper">Give your franchise its own identity. Your custom team can play in the same auction as official IPL teams.</p>
                    <div className="custom-preview" style={{ "--team-color": customTeamForm.color }}><span>{customTeamForm.logo ? <img src={customTeamForm.logo} alt="Custom team logo preview" /> : customTeamForm.badge}</span><div><small>LIVE CUSTOM PREVIEW</small><b>{customTeamForm.name || "Your custom franchise"}</b><em>{(customTeamForm.shortName || "TEAM").toUpperCase()}</em></div></div>
                    <div className="custom-franchise-fields">
                      <label>TEAM NAME<input required minLength="2" maxLength="28" value={customTeamForm.name} onChange={(e) => setCustomTeamForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Coastal Thunder" /></label>
                      <label>SHORT NAME<input required minLength="2" maxLength="5" value={customTeamForm.shortName} onChange={(e) => setCustomTeamForm((prev) => ({ ...prev, shortName: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") }))} placeholder="e.g. CT" /></label>
                      <label>TEAM COLOUR<input type="color" value={customTeamForm.color} onChange={(e) => setCustomTeamForm((prev) => ({ ...prev, color: e.target.value }))} /></label>
                      <label>TEAM EMBLEM<select value={customTeamForm.badge} onChange={(e) => setCustomTeamForm((prev) => ({ ...prev, badge: e.target.value, logo: "" }))}>{CUSTOM_BADGES.map((badge) => <option key={badge} value={badge}>{badge}</option>)}</select></label>
                      <label className="logo-upload-field">UPLOAD CUSTOM LOGO<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 120 * 1024) { setMessage("Please choose a PNG, JPG or WEBP logo smaller than 120 KB."); e.target.value = ""; return; } const reader = new FileReader(); reader.onload = () => setCustomTeamForm((prev) => ({ ...prev, logo: String(reader.result || "") })); reader.readAsDataURL(file); }} /><small>Optional · PNG/JPG/WEBP · max 120 KB</small></label>
                    </div>
                    <button className="btn btn-primary custom-confirm-btn" type="submit" disabled={busy || connectedMembers.length > room.settings.humanLimit}>CONFIRM MY CUSTOM FRANCHISE →</button>
                  </form>
                )}
              </>
            )}
            <div className="lobby-note"><span>✦</span> Your choice is personal to your account. Friends in this room can choose a different franchise style.</div>
          </section>

          <aside className="lobby-side">
            <section className="panel-box participants-box">
              <div className="panel-heading"><div><span className="eyebrow">LIVE ROOM ROSTER</span><h2>Participants</h2></div><span className="count-badge">{connectedMembers.length}/{room.settings.humanLimit}</span></div>
              {room.members.map((member) => {
                const team = room.teams.find((item) => item.id === member.teamId);
                return <div className="participant-row participant-row-v4" key={member.id}>
                  <div className="avatar">{initials(member.name)}</div>
                  <div className="participant-meta"><b>{member.name}{member.id === room.hostMemberId && <em>HOST</em>}</b><small>{team ? `${team.shortName} · ${team.isCustom ? "CUSTOM" : "IPL"}` : "Choosing franchise..."}</small></div>
                  <span className={`status-tag ${member.connected && team ? "ready" : member.connected ? "choosing" : "away"}`}>{!member.connected ? "AWAY" : team ? "READY" : "CHOOSING"}</span>
                </div>;
              })}
              <div className="roster-progress"><div><span style={{ width: `${connectedMembers.length ? (readyMembers.length / connectedMembers.length) * 100 : 0}%` }} /></div><small>{readyMembers.length} of {connectedMembers.length} connected participants confirmed their franchise.</small></div>
            </section>

            <section className="panel-box claimed-franchises-panel">
              <div className="panel-heading"><div><span className="eyebrow">FRANCHISE SEATS</span><h2>Selected teams</h2></div><span className="count-badge">{claimedTeams.length}/{room.settings.teamCount}</span></div>
              {claimedTeams.length ? claimedTeams.map((team) => <div className="claimed-franchise-row" key={team.id} style={{ "--team-color": team.color }}><span className="claimed-emblem">{team.logo ? <img src={team.logo} alt="" /> : team.badge || initials(team.shortName)}</span><span><b>{team.name}</b><small>{team.ownerName} · {team.isCustom ? "Custom" : "IPL"}</small></span></div>) : <p className="profile-empty">No franchises selected yet.</p>}
              <div className="bot-summary"><span className="bot-avatar">✦</span><div><b>{botSeatsAfterStart} AI rivals will be assigned</b><small>Unused seats are filled automatically when the host starts.</small></div></div>
            </section>

            <section className="panel-box settings-summary">
              <span className="eyebrow">AUCTION SETTINGS</span>
              <div className="setting-line"><span>Human participants</span><b>{connectedMembers.length} / {room.settings.humanLimit}</b></div>
              <div className="setting-line"><span>Total franchises</span><b>{room.settings.teamCount}</b></div>
              <div className="setting-line"><span>Starting purse</span><b>{formatCr(room.settings.initialPurse)}</b></div>
              <div className="setting-line"><span>Rule profile</span><b>{room.settings.restrictionMode === "IPL" ? "IPL standard" : room.settings.restrictionMode === "CUSTOM" ? "Custom" : "No restrictions"}</b></div>
              <div className="setting-line"><span>Squad size</span><b>{room.settings.minSquadSize || "No min"} – {room.settings.maxSquadSize}</b></div>
              <div className="setting-line"><span>Overseas maximum</span><b>{room.settings.maxOverseasPlayers >= 263 ? "Unlimited" : room.settings.maxOverseasPlayers}</b></div>
              <div className="setting-line"><span>Bot difficulty</span><b>{room.settings.botDifficulty}</b></div>
              <div className="setting-line"><span>Auctioneer</span><b>{room.settings.auctioneerMode}</b></div>
              {isCreator ? <button className="btn btn-primary start-button" onClick={startAuction} disabled={busy || !allParticipantsReady}>{busy ? "STARTING..." : allParticipantsReady ? "ALL READY · START AUCTION →" : "WAITING FOR TEAM SELECTIONS"}</button> : <div className="waiting-host">Waiting for the room creator to start the auction.</div>}
              {!allParticipantsReady && <div className="small-warning">The creator can start after every connected participant selects their franchise.</div>}
            </section>
          </aside>
        </div>
        {message && <div className="inline-alert workspace-alert" role="alert">{message}</div>}
      </main>
    );
  };

  const renderGame = () => {
    if (!currentPlayer) return <main className="workspace"><div className="panel-box center-box"><span className="eyebrow">AUCTION COMPLETE</span><h1>All players processed.</h1><button className="btn btn-primary" onClick={() => setScreen("RESULTS")}>VIEW FINAL SQUADS</button></div></main>;
    const timerPercent = room.settings.timerSeconds > 0 ? (secondsLeft / room.settings.timerSeconds) * 100 : 0;
    const leadingColor = highestTeam?.color || "#d9aa56";
    const selectedSquadTeam = activeTeam ? room.teams.find((team) => team.id === activeTeam) : null;
    const squadRoleGroups = SQUAD_ROLE_GROUPS.map((group) => ({
      ...group,
      players: selectedSquadTeam?.players?.filter((player) => player.role === group.key) || []
    }));
    const selectedOverseasCount = getOverseasCount(selectedSquadTeam?.players || []);
    const restrictionLabel = room.settings.restrictionMode === "IPL" ? "IPL STANDARD" : room.settings.restrictionMode === "CUSTOM" ? "CUSTOM RULES" : "NO SQUAD RESTRICTIONS";
    const minTarget = Number(room.settings.minSquadSize || 0);
    return (
      <main className="workspace game-workspace">
        <div className="game-topline"><div><span className={`live-dot ${room.auction.paused ? "paused-dot" : ""}`} /> {room.auction.paused ? "AUCTION PAUSED" : "LIVE AUCTION"} <span className="game-code">ROOM {room.code}</span></div><div className="game-progress">PLAYER <b>{room.auction.playerNumber}</b> / {room.auction.totalPlayers}</div><button className="btn btn-ghost btn-small" onClick={leaveRoom}>EXIT</button></div>
        <div className={`auction-control-bar ${room.auction.paused ? "is-paused" : ""}`}>
          <div className="auction-control-status"><span className="control-status-icon">{room.auction.paused ? "Ⅱ" : "●"}</span><div><b>{room.auction.paused ? "AUCTION ON HOLD" : "AUCTION IN PROGRESS"}</b><small>{room.auction.paused ? "Bidding and AI decisions are frozen until the host resumes." : "All participants are watching the same live auction."}</small></div></div>
          <div className="auction-control-actions">
            {isCreator && <button className="btn btn-pause" onClick={toggleAuctionPause} disabled={busy || !currentPlayer || room.auction.transitioning}>{busy ? "PLEASE WAIT" : room.auction.paused ? "RESUME AUCTION ▶" : "PAUSE AUCTION Ⅱ"}</button>}
            {isCreator && <button className="btn btn-end" onClick={endAuction} disabled={busy}>END AUCTION ■</button>}
          </div>
        </div>
        <section className="auction-rules-strip panel-box" aria-label="Auction restrictions visible to all participants">
          <div className="rules-strip-heading"><span className="eyebrow">AUCTION RULES · VISIBLE TO EVERYONE</span><b>{restrictionLabel}</b></div>
          <div className="rules-strip-items">
            <div><b>{minTarget > 0 ? minTarget : "—"}</b><span>MINIMUM SQUAD {minTarget > 0 ? "TARGET" : "NONE"}</span></div>
            <div><b>{room.settings.maxSquadSize >= 263 ? "263" : room.settings.maxSquadSize}</b><span>MAXIMUM SQUAD</span></div>
            <div><b>{room.settings.maxOverseasPlayers >= 263 ? "∞" : room.settings.maxOverseasPlayers}</b><span>OVERSEAS PLAYERS MAX</span></div>
            <div><b>{room.settings.restrictionMode === "NONE" ? "OFF" : "ON"}</b><span>ROSTER VALIDATION</span></div>
          </div>
          <small className="rules-strip-note">Maximum squad size and overseas-player limit are enforced during bidding. Minimum squad size is a target and any shortfall is shown in squad status.</small>
        </section>
        {room.auction.lastResult && <div key={`${room.auction.lastResult.playerName}-${room.auction.lastResult.status}-${room.auction.lastResult.amount || "skip"}`} className={`sale-banner ${room.auction.lastResult.status === "SOLD" ? "sold" : "unsold"}`}><b>{room.auction.lastResult.status}</b><span>{room.auction.lastResult.status === "SOLD" ? `${room.auction.lastResult.playerName} → ${room.auction.lastResult.teamName} for ${formatCr(room.auction.lastResult.amount)}` : room.auction.lastResult.skippedBy ? `${room.auction.lastResult.playerName} skipped by ${room.auction.lastResult.skippedBy}` : `${room.auction.lastResult.playerName} did not receive a bid`}</span></div>}
        <div className="game-grid game-grid-v6">
          <aside className="game-left-stack">
            <section className="panel-box activity-panel"><div className="panel-heading"><div><span className="eyebrow">LIVE FEED</span><h2>Auction activity</h2></div><span className="activity-live-tag">● LIVE</span></div><div className="activity-list">{[...(room.auction.history || [])].slice(-10).reverse().map((item) => <div className={`activity-item ${item.type.toLowerCase()}`} key={item.id}><i /> <div><p>{item.message}</p><small>{formatTime(item.at)}</small></div></div>)}</div></section>
            <section className="panel-box remaining-players-panel"><div className="panel-heading"><div><span className="eyebrow">PLAYER QUEUE</span><h2>Players remaining</h2></div><span className="count-badge">{Math.max(0, room.auction.totalPlayers - room.auction.completedCount)}</span></div><p className="remaining-panel-note">The counts below include the current lot and every unsold player still to come.</p>{(room.auction.remainingByCategory || []).map((category) => <details className="remaining-category" key={category.key}><summary><span>{category.label}</span><b>{category.total}</b><small>{category.domesticCount} domestic · {category.overseasCount} overseas</small></summary><div className="remaining-name-columns"><div><strong>DOMESTIC · {category.domesticCount}</strong>{category.domesticNames.map((name) => <span key={name}>{name}</span>)}</div><div><strong>OVERSEAS · {category.overseasCount}</strong>{category.overseasNames.map((name) => <span key={name}>{name}</span>)}</div></div></details>)}</section>
            <section className="panel-box chat-panel"><div className="panel-heading"><div><span className="eyebrow">ROOM SOCIAL</span><h2>Live chat</h2></div></div><div className="chat-messages">{(room.chat || []).slice(-24).map((item) => <div className={`chat-message ${item.system ? "system" : ""}`} key={item.id}><div><b>{item.name}</b><small>{formatTime(item.at)}</small></div><p>{item.text}</p></div>)}<div ref={chatEndRef} /></div><form className="chat-compose" onSubmit={sendChat}><input maxLength="240" value={chatText} onChange={(e) => setChatText(e.target.value)} placeholder="Message your room..." /><button type="submit" disabled={!chatText.trim()}>SEND</button></form></section>
          </aside>
          <section className="auction-stage panel-box">
            <div className="stage-top"><span className="eyebrow">NOW ON THE AUCTION BLOCK</span><span className="player-index">LOT #{String(room.auction.playerNumber).padStart(3, "0")}</span></div>
            <div className="player-showcase" key={currentPlayer.id}>
              <div className="player-photo-wrap"><PlayerPortrait player={currentPlayer} className="player-photo"/><span className="photo-ring" /></div>
              <div className="player-details"><span className="player-role">{currentPlayer.role.toUpperCase()}</span><h1>{currentPlayer.name}</h1><p>{currentPlayer.nationality || "Player"} · IPL PLAYER POOL <span className="arena-rating-badge" title="A game-balance score used by the AI, not an official cricket statistic">ARENA RATING {Number(currentPlayer.arenaRating || 70)}/100</span></p><div className="base-price">BASE PRICE <b>{formatCr(currentPlayer.basePrice)}</b></div></div>
            </div>
            <div className="bid-display">
              <div className="bid-display-label">CURRENT HIGHEST BID</div>
              <div key={`${currentPlayer.id}-${room.auction.currentBid}`} className="bid-value" style={{ color: leadingColor }}>{formatCr(room.auction.currentBid || currentPlayer.basePrice)}</div>
              <div className="leading-team">{highestTeam ? <><span className="leading-dot" style={{ background: highestTeam.color }} /> {highestTeam.shortName} LEADS <small>· {highestTeam.ownerName}</small></> : <span>NO BIDS YET — MAKE THE OPENING BID</span>}</div>
              {(room.auction.passedTeamIds || []).length > 0 && <div className="pass-counter">{room.auction.passedTeamIds.length} FRANCHISE{room.auction.passedTeamIds.length === 1 ? "" : "S"} PASSED · AUCTION CONTINUES</div>}
              <div className={`timer-area ${room.auction.paused ? "timer-paused" : ""}`}><div className={`timer-number ${secondsLeft <= 5 && !room.auction.paused ? "urgent" : ""}`}>{room.auction.paused ? "Ⅱ" : room.auction.waitingForDecision ? "—" : String(secondsLeft).padStart(2, "0")}</div><div className="timer-track"><span style={{ width: `${Math.max(0, Math.min(100, timerPercent))}%` }} /></div><small>{room.auction.paused ? "TIMER FROZEN BY ROOM CREATOR" : room.auction.waitingForDecision ? "AWAITING AUCTIONEER DECISION" : "SECONDS LEFT TO BID"}</small></div>
            </div>
            <div className="bid-action-area">
              {myTeam ? <><div className="my-franchise-label"><span className="my-team-dot" style={{ background: myTeam.color }} /> YOU ARE PLAYING FOR <b>{myTeam.shortName}</b> · PURSE {formatCr(myTeam.purse)}</div><div className="bid-action-buttons"><button className="btn btn-bid" disabled={!myTurnToBid || busy} onClick={placeBid}>{busy ? "PLACING BID..." : room.auction.highestBidTeamId === myTeam.id ? "YOU ARE LEADING" : myTeamPassed ? "PASSED ON THIS PLAYER" : myOverseasLimitReached ? "OVERSEAS LIMIT REACHED" : `BID ${formatCr(nextBid)}`} <span>↗</span></button><button className="btn btn-pass" disabled={busy || !currentPlayer || room.auction.paused || room.auction.waitingForDecision || room.auction.transitioning || myTeamPassed || room.auction.highestBidTeamId === myTeam.id || room.status !== "LIVE"} onClick={passOnPlayer}>{myTeamPassed ? "✓ PASSED · WATCHING" : "PASS ON PLAYER ↷"}</button></div>{myTeamPassed ? <small className="bid-hint pass-hint">You have passed on this player. Watch the remaining bids; you can bid again on the next player.</small> : myOverseasLimitReached ? <small className="bid-hint rules-warning-text">Your franchise has reached its overseas-player limit. You can bid again on domestic players.</small> : !myTurnToBid && !room.auction.waitingForDecision && <small className="bid-hint">{room.auction.highestBidTeamId === myTeam.id ? "Your franchise is leading. Wait for another bid." : room.auction.highestBidTeamId && room.teams.find((team) => team.id === room.auction.highestBidTeamId)?.ownerType === "BOT" ? "An AI franchise is currently leading." : myTeam.purse < nextBid ? "Not enough purse for the next bid." : myTeam.players.length >= room.settings.maxSquadSize ? "Your squad is full." : "Bidding is temporarily closed."}</small>}</> : <div className="spectator-hint">You are watching this auction as a spectator.</div>}
              {isHost && room.settings.auctioneerMode === "MANUAL" && room.auction.waitingForDecision && <div className="auctioneer-controls"><span>AUCTIONEER DECISION</span><div><button className="btn btn-sold" onClick={() => auctioneerDecision("SOLD")} disabled={!highestTeam || busy}>SOLD</button><button className="btn btn-unsold" onClick={() => auctioneerDecision("UNSOLD")} disabled={busy}>UNSOLD</button></div></div>}
            </div>
          </section>
          <aside className="side-stack game-right-stack">
            <section className="panel-box team-board"><div className="panel-heading"><div><span className="eyebrow">FRANCHISES</span><h2>Team purse</h2></div><span className="count-badge">{room.teams.length}</span></div><div className="team-list">{room.teams.map((team) => <button key={team.id} className={`team-row ${team.id === room.auction.highestBidTeamId ? "team-leading" : ""} ${team.id === myTeam?.id ? "team-mine" : ""}`} onClick={() => setActiveTeam(activeTeam === team.id ? null : team.id)}><span className="team-color-bar" style={{ background: team.color }} />{team.logo ? <span className="team-inline-emblem"><img src={team.logo} alt="" /></span> : <span className="team-inline-emblem custom" style={{ "--team-color": team.color }}>{team.badge || initials(team.shortName)}</span>}<span className="team-short">{team.shortName}</span><span className="team-owner">{team.ownerType === "BOT" ? `AI · ${botPersonalityLabel(team.personality)}` : team.ownerName}</span><span className="team-purse">{formatCr(team.purse).replace(" Cr", "")}</span><span className="team-count">{team.players.length}</span></button>)}</div><div className="team-board-legend"><span><i className="legend-human" /> HUMAN</span><span><i className="legend-bot" /> AI FRANCHISE</span><span>PLAYERS</span></div><small className="team-board-help">Select a franchise to inspect its squad by role.</small></section>
            {selectedSquadTeam && <section className="panel-box selected-squad selected-squad-detailed"><div className="panel-heading"><div><span className="eyebrow">FRANCHISE SQUAD</span><h2>{selectedSquadTeam.shortName}</h2><small className="squad-owner-label">{selectedSquadTeam.name} · {selectedSquadTeam.ownerName}</small></div><button className="close-mini" onClick={() => setActiveTeam(null)} aria-label="Close squad details">×</button></div>
              <div className="squad-mini-stats"><div><b>{selectedSquadTeam.players.length}</b><span>PLAYERS</span></div><div><b>{selectedOverseasCount}</b><span>OVERSEAS</span></div><div><b>{formatCr(selectedSquadTeam.purse).replace(" Cr", "")}</b><span>PURSE LEFT</span></div></div>
              <div className="squad-compliance-row"><span>MINIMUM TARGET</span><b className={minTarget === 0 || selectedSquadTeam.players.length >= minTarget ? "compliance-good" : "compliance-pending"}>{minTarget === 0 ? "NO MINIMUM" : `${Math.max(0, minTarget - selectedSquadTeam.players.length)} TO GO`}</b><span>OVERSEAS CAP</span><b className={selectedOverseasCount <= room.settings.maxOverseasPlayers ? "compliance-good" : "compliance-pending"}>{selectedOverseasCount}/{room.settings.maxOverseasPlayers >= 263 ? "∞" : room.settings.maxOverseasPlayers}</b></div>
              <div className="squad-role-groups">{squadRoleGroups.map((group) => <section className="squad-role-group" key={group.key}><div className="squad-role-heading"><span>{group.icon} {group.label}</span><b>{group.players.length}</b></div>{group.players.length ? group.players.map((player) => <div className="squad-role-player" key={`${group.key}-${player.id}`}><span>{player.name}<small>{player.nationality || (player.isOverseas ? "Overseas" : "India")}</small></span><b>{formatCr(player.finalPrice)}</b></div>) : <p className="squad-role-empty">No {group.label.toLowerCase()} signed yet.</p>}</section>)}</div>
            </section>}
          </aside>
        </div>
        {message && <div className="inline-alert workspace-alert">{message}</div>}
        <div className="game-bottom"><div><b>PLAY SMART. BID SMARTER.</b><span>Every franchise has the same rules, whether owned by a friend or AI.</span></div><span>{botCount} AI RIVALS · {humanCount} HUMAN PLAYERS</span></div>
      </main>
    );
  };

  const renderPoolReview = () => {
    const pool = room?.auction?.poolPreview;
    const confirmed = room?.auction?.poolReadyMemberIds || [];
    const connected = room?.members?.filter((member) => member.connected) || [];
    const iConfirmed = confirmed.includes(memberId);
    return <main className="workspace pool-review-workspace">
      <div className="pool-review-hero panel-box">
        <div><span className="eyebrow">PRE-AUCTION PLAYER BRIEFING</span><h1>REVIEW THE <span>PLAYER POOL.</span></h1><p>Every participant sees the same player list. Check the categories and overseas split before the auction begins.</p></div>
        <div className="pool-review-total"><b>{pool?.totalPlayers || 0}</b><span>PLAYERS IN THIS AUCTION</span><small>{pool?.categories?.reduce((sum, category) => sum + category.overseasCount, 0) || 0} overseas · {room?.settings?.teamCount || 0} franchises</small></div>
      </div>
      <section className="pool-review-progress panel-box">
        <div className="panel-heading"><div><span className="eyebrow">PARTICIPANT CONFIRMATION</span><h2>Everyone must be ready</h2></div><span className="count-badge">{confirmed.length}/{connected.length}</span></div>
        <div className="pool-ready-members">{connected.map((member) => <div className={`pool-ready-member ${confirmed.includes(member.id) ? "confirmed" : "pending"}`} key={member.id}><span>{confirmed.includes(member.id) ? "✓" : "…"}</span><b>{member.name}</b><small>{confirmed.includes(member.id) ? "POOL CONFIRMED" : "REVIEWING"}</small></div>)}</div>
        <div className="pool-ready-bar"><span style={{ width: `${connected.length ? confirmed.length / connected.length * 100 : 0}%` }} /></div>
        <p className="pool-review-hint">The auction starts automatically after every connected human participant clicks <b>OK, START AUCTION</b>. AI franchises are not required to confirm.</p>
      </section>
      <section className="pool-categories-grid">
        {(pool?.categories || []).map((category) => <article className="panel-box pool-category-card" key={category.key}>
          <div className="pool-category-heading"><div><span className="eyebrow">PLAYER CATEGORY</span><h2>{category.label}</h2></div><b>{category.total}</b></div>
          <div className="pool-category-stats"><span>🇮🇳 DOMESTIC <b>{category.domesticCount}</b></span><span>✈ OVERSEAS <b>{category.overseasCount}</b></span></div>
          <details className="pool-name-group" open><summary>Domestic players <b>{category.domesticCount}</b></summary><div className="pool-name-list">{category.domesticPlayers.map((player) => <div key={player.id}><PlayerPortrait player={player} className="pool-player-thumb"/><span>{player.name}<small>{player.nationality}</small></span><b>{formatCr(player.basePrice)}</b></div>)}</div></details>
          <details className="pool-name-group"><summary>Overseas players <b>{category.overseasCount}</b></summary><div className="pool-name-list">{category.overseasPlayers.map((player) => <div key={player.id}><PlayerPortrait player={player} className="pool-player-thumb"/><span>{player.name}<small>{player.nationality}</small></span><b>{formatCr(player.basePrice)}</b></div>)}</div></details>
        </article>)}
      </section>
      <div className="pool-review-actions"><button className="btn btn-outline" onClick={leaveRoom}>LEAVE ROOM</button><button className="btn btn-primary pool-confirm-button" disabled={busy || iConfirmed} onClick={confirmPlayerPool}>{busy ? "SAVING CONFIRMATION..." : iConfirmed ? "✓ PLAYER POOL CONFIRMED" : "OK, START AUCTION →"}</button></div>
      {message && <div className="inline-alert workspace-alert">{message}</div>}
    </main>;
  };

  const renderPlayerManager = () => {
    const filtered = playerCatalog.players.filter((player) => {
      const matchesSearch = `${player.name} ${player.nationality} ${player.role}`.toLowerCase().includes(playerSearch.toLowerCase());
      return matchesSearch && (playerRoleFilter === "ALL" || player.role === playerRoleFilter);
    });
    const overseasCount = playerCatalog.players.filter(isOverseasPlayer).length;
    return <main className="workspace player-manager-workspace">
      <div className="workspace-heading"><div><span className="eyebrow">V7 · PLAYER OPERATIONS</span><h1>PLAYER <span>MANAGEMENT.</span></h1><p>Search the expanded seed pool, add your own players, edit custom entries and import a CSV squad list.</p></div><button className="btn btn-ghost" onClick={() => setScreen("HOME")}>BACK TO ARENA</button></div>
      <div className="player-manager-stats"><div className="panel-box"><b>{playerCatalog.total}</b><span>TOTAL PLAYERS</span></div><div className="panel-box"><b>{playerCatalog.builtIn}</b><span>SEED POOL</span></div><div className="panel-box"><b>{playerCatalog.custom}</b><span>YOUR CUSTOM PLAYERS</span></div><div className="panel-box"><b>{overseasCount}</b><span>OVERSEAS PLAYERS</span></div></div>
      <section className="panel-box player-manager-toolbar"><div><span className="eyebrow">PLAYER DATABASE</span><h2>Manage the auction pool</h2></div><div className="player-manager-actions"><button className="btn btn-outline btn-small" onClick={exportPlayerCatalog} disabled={!playerCatalog.players.length}>EXPORT CSV</button><label className="btn btn-outline btn-small csv-import-button">IMPORT CSV<input type="file" accept=".csv,text/csv" onChange={importPlayerCsv}/></label><button className="btn btn-primary btn-small" onClick={() => { resetPlayerForm(); setPlayerFormOpen(true); }}>+ ADD PLAYER</button></div></section>
      {playerCatalogMessage && <div className="inline-alert success-alert">{playerCatalogMessage}</div>}
      {playerCatalogError && <div className="inline-alert auth-alert" role="alert">{playerCatalogError}</div>}
      {playerFormOpen && <form className="panel-box player-edit-form" onSubmit={savePlayer}>
        <div className="panel-heading"><div><span className="eyebrow">CUSTOM PLAYER RECORD</span><h2>{playerEditingId ? "Edit player" : "Add a player"}</h2></div><button type="button" className="close-mini" onClick={resetPlayerForm}>×</button></div>
        <div className="player-edit-grid">
          <label>Player name<input required minLength="2" maxLength="60" value={playerForm.name} onChange={(event) => setPlayerForm((previous) => ({ ...previous, name: event.target.value }))} placeholder="e.g. Arjun Mehta"/></label>
          <label>Role<select value={playerForm.role} onChange={(event) => setPlayerForm((previous) => ({ ...previous, role: event.target.value }))}>{SQUAD_ROLE_GROUPS.map((group) => <option value={group.key} key={group.key}>{group.label}</option>)}</select></label>
          <label>Nationality<input required value={playerForm.nationality} onChange={(event) => setPlayerForm((previous) => ({ ...previous, nationality: event.target.value }))} placeholder="India"/></label>
          <label>Base price (Cr)<input required type="number" min="0.1" max="20" step="0.05" value={playerForm.basePrice} onChange={(event) => setPlayerForm((previous) => ({ ...previous, basePrice: event.target.value }))}/></label>
          <label>Arena rating (50–99)<input required type="number" min="50" max="99" step="1" value={playerForm.arenaRating} onChange={(event) => setPlayerForm((previous) => ({ ...previous, arenaRating: event.target.value }))}/></label>
          <label>Profile image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => uploadPlayerImage(event.target.files?.[0])}/><small>PNG/JPG/WEBP · maximum 600 KB. Leave blank for an automatic Arena avatar.</small></label>
          <label className="player-image-url-field">Or image URL (HTTPS)<input type="url" value={playerForm.image.startsWith("data:") || playerForm.image.startsWith("/player-avatars/") ? "" : playerForm.image} onChange={(event) => setPlayerForm((previous) => ({ ...previous, image: event.target.value }))} placeholder="https://..."/></label>
        </div>
        {playerForm.image && <div className="player-form-preview"><img src={playerForm.image} alt="Player preview" onError={(event) => { event.currentTarget.style.display = "none"; }}/><span>IMAGE PREVIEW</span></div>}
        {playerFormError && <div className="inline-alert auth-alert">{playerFormError}</div>}
        <div className="player-form-actions"><button type="button" className="btn btn-ghost" onClick={resetPlayerForm}>CANCEL</button><button type="submit" className="btn btn-primary" disabled={playerFormBusy}>{playerFormBusy ? "SAVING..." : playerEditingId ? "SAVE CHANGES" : "ADD PLAYER TO POOL"}</button></div>
      </form>}
      <section className="player-directory-section">
        <div className="player-directory-filter"><input value={playerSearch} onChange={(event) => setPlayerSearch(event.target.value)} placeholder="Search player, nationality or role..."/><select value={playerRoleFilter} onChange={(event) => setPlayerRoleFilter(event.target.value)}><option value="ALL">All categories</option>{SQUAD_ROLE_GROUPS.map((group) => <option key={group.key} value={group.key}>{group.label}</option>)}</select><span>{filtered.length} RESULTS</span></div>
        {playerCatalogLoading ? <div className="panel-box center-box">Loading player database...</div> : <div className="player-catalog-grid">{filtered.map((player) => <article className="panel-box player-catalog-card" key={player.id}><div className="player-catalog-image"><PlayerPortrait player={player}/><span className="player-rating-chip">{player.arenaRating || 70}/99</span></div><div className="player-catalog-info"><span className="eyebrow">{player.role}</span><h3>{player.name}</h3><p>{player.nationality || "India"} · {isOverseasPlayer(player) ? "OVERSEAS" : "DOMESTIC"}</p><small className="player-image-source">{player.imageType === "official-headshot" ? "IPL HEADSHOT" : player.imageType === "arena-avatar" ? "ARENA PROFILE ART" : "CUSTOM PLAYER IMAGE"}</small><b>{formatCr(player.basePrice)}</b></div><div className="player-catalog-actions">{player.editable ? <><button className="btn btn-outline btn-small" onClick={() => editPlayer(player)}>EDIT</button><button className="btn btn-ghost btn-small" onClick={() => deletePlayer(player)}>REMOVE</button></> : <span className="readonly-chip">BUILT-IN SEED RECORD</span>}</div></article>)}</div>}
      </section>
    </main>;
  };

  const renderAnalytics = () => {
    const data = analyticsData;
    const roleEntries = Object.entries(data?.roleSpend || {}).sort((a, b) => b[1] - a[1]);
    const maxRoleSpend = Math.max(1, ...roleEntries.map((entry) => Number(entry[1] || 0)));
    const maxFranchiseSpend = Math.max(1, ...(data?.franchiseSpend || []).map((entry) => Number(entry.amount || 0)));
    return <main className="workspace analytics-workspace">
      <div className="workspace-heading"><div><span className="eyebrow">V7 · AUCTION INTELLIGENCE</span><h1>AUCTION <span>ANALYTICS.</span></h1><p>Insights from auctions you've participated in and your current player pool.</p></div><div className="analytics-actions"><button className="btn btn-outline btn-small" onClick={loadAnalytics}>REFRESH DATA</button><button className="btn btn-ghost" onClick={() => setScreen("HOME")}>BACK TO ARENA</button></div></div>
      {analyticsError && <div className="inline-alert auth-alert">{analyticsError}</div>}
      {analyticsLoading && !data ? <div className="panel-box center-box">Loading analytics...</div> : <>
        <div className="analytics-kpi-grid"><div className="panel-box"><span>PLAYER POOL</span><b>{data?.playersInPool ?? 263}</b><small>seed + your custom entries</small></div><div className="panel-box"><span>AUCTIONS PLAYED</span><b>{data?.auctionsPlayed ?? 0}</b><small>completed archives</small></div><div className="panel-box"><span>PLAYERS SOLD</span><b>{data?.soldPlayers ?? 0}</b><small>across your archived rooms</small></div><div className="panel-box"><span>COMBINED SPEND</span><b>{formatCr(data?.totalSpent || 0)}</b><small>all franchises in archived rooms</small></div><div className="panel-box"><span>AVERAGE PER AUCTION</span><b>{formatCr(data?.averageSpendPerAuction || 0)}</b><small>combined auction expenditure</small></div><div className="panel-box"><span>OVERSEAS POOL</span><b>{data?.overseasInPool ?? 0}</b><small>players in your catalog</small></div></div>
        <div className="analytics-content-grid">
          <section className="panel-box analytics-panel"><div className="panel-heading"><div><span className="eyebrow">SPENDING BY ROLE</span><h2>Player category spend</h2></div></div>{roleEntries.map(([role, value]) => <div className="analytics-bar-row" key={role}><div><span>{role}</span><b>{formatCr(value)}</b></div><div className="analytics-track"><i style={{ width: `${Math.max(0, Number(value) / maxRoleSpend * 100)}%` }}/></div></div>)}</section>
          <section className="panel-box analytics-panel"><div className="panel-heading"><div><span className="eyebrow">HIGHEST PURCHASE</span><h2>Record signing</h2></div></div>{data?.highestPurchase ? <div className="highest-purchase-card"><b>{formatCr(data.highestPurchase.price)}</b><h3>{data.highestPurchase.name}</h3><span>{data.highestPurchase.team}</span></div> : <p className="profile-empty">Complete an auction to record your first signing.</p>}<div className="top-purchased-list"><span className="eyebrow">MOST PURCHASED PLAYER NAMES</span>{(data?.topPurchasedPlayers || []).slice(0, 6).map((item, index) => <div key={item.name}><b>#{index + 1} {item.name}</b><small>{item.times} purchases</small></div>)}</div></section>
          <section className="panel-box analytics-panel franchise-analytics-panel"><div className="panel-heading"><div><span className="eyebrow">FRANCHISE EXPENDITURE</span><h2>Top spending teams</h2></div></div>{(data?.franchiseSpend || []).length ? data.franchiseSpend.map((item) => <div className="analytics-bar-row" key={item.team}><div><span>{item.team}</span><b>{formatCr(item.amount)}</b></div><div className="analytics-track"><i style={{ width: `${Math.max(0, Number(item.amount) / maxFranchiseSpend * 100)}%` }}/></div></div>) : <p className="profile-empty">No archived franchise spending yet.</p>}</section>
          <section className="panel-box analytics-panel"><div className="panel-heading"><div><span className="eyebrow">RECENT AUCTIONS</span><h2>Recent match records</h2></div></div>{(data?.recentAuctions || []).length ? <div className="analytics-recent-list">{data.recentAuctions.map((auction) => <div key={`${auction.roomCode}-${auction.completedAt}`}><b>ROOM {auction.roomCode}</b><span>{auction.teamCount} teams · {auction.soldCount}/{auction.playerCount} sold</span><strong>{formatCr(auction.totalSpent)}</strong></div>)}</div> : <p className="profile-empty">Your completed auctions will appear here.</p>}</section>
        </div>
      </>}
    </main>;
  };

  const renderResults = () => {
    const soldPlayers = room.teams.reduce((sum, team) => sum + team.players.length, 0);
    const totalSpent = room.teams.reduce((sum, team) => sum + team.spent, 0);
    const sortedTeams = [...room.teams].sort((a, b) => b.spent - a.spent);
    return <main className="workspace results-workspace"><div className="results-hero"><span className="eyebrow">THE HAMMER HAS FALLEN</span><h1>AUCTION <span>{room.auction?.endedEarly ? "ENDED." : "COMPLETE."}</span></h1><p>{room.auction?.endedEarly ? "The host closed the auction early. Every franchise squad is shown below." : "All players have been processed. Every franchise squad is shown below."}</p><div className="results-stats"><div><b>{soldPlayers}</b><span>PLAYERS SOLD</span></div><div><b>{Math.max(0, (room.auction?.completedCount || 0) - soldPlayers)}</b><span>UNSOLD / SKIPPED</span></div><div><b>{formatCr(totalSpent)}</b><span>TOTAL SPENT</span></div><div><b>{Math.max(0, (room.auction?.totalPlayers || 0) - (room.auction?.completedCount || 0))}</b><span>NOT PROCESSED</span></div></div></div>
      <div className="results-heading"><div><span className="eyebrow">FINAL FRANCHISE RANKINGS</span><h2>Squad room</h2></div><button className="btn btn-ghost" onClick={leaveRoom}>BACK TO HOME</button></div>
      <div className="results-grid">{sortedTeams.map((team, index) => <article className="result-team-card" key={team.id} style={{ "--team-color": team.color }}><div className="result-team-head"><span className="rank">#{index + 1}</span><span className="result-team-emblem" style={{ "--team-color": team.color }}>{team.logo ? <img src={team.logo} alt="" /> : (team.badge || initials(team.shortName))}</span><div><b>{team.name || team.shortName}</b><small>{team.shortName} · {team.ownerType === "BOT" ? "AI FRANCHISE" : team.ownerName}</small></div><span className="spent-total">{formatCr(team.spent)}</span></div><div className="result-team-metrics"><span>{team.players.length} PLAYERS</span><span>{formatCr(team.purse)} LEFT</span></div><div className="result-team-compliance"><span>{room.settings.minSquadSize > 0 ? (team.players.length >= room.settings.minSquadSize ? "MINIMUM MET" : `${room.settings.minSquadSize - team.players.length} BELOW MIN`) : "NO MINIMUM"}</span><span>{getOverseasCount(team.players)} / {room.settings.maxOverseasPlayers >= 263 ? "∞" : room.settings.maxOverseasPlayers} OVERSEAS</span></div><div className="result-squad-list">{team.players.length ? team.players.map((player) => <div key={player.id}><span>{player.name}<small>{player.role}</small></span><b>{formatCr(player.finalPrice)}</b></div>) : <p>No players purchased.</p>}</div></article>)}</div>
      <div className="results-actions"><button className="btn btn-primary" onClick={leaveRoom}>CREATE ANOTHER AUCTION →</button></div>
    </main>;
  };

  return <div className={`app-shell theme-${theme.toLowerCase()}`}>{renderHeader()}{authLoading ? <main className="workspace"><div className="panel-box center-box">Restoring your account session...</div></main> : !account ? renderAuth() : screen === "PROFILE" ? renderProfile() : screen === "PLAYERS" ? renderPlayerManager() : screen === "ANALYTICS" ? renderAnalytics() : screen === "HOME" ? renderHome() : screen === "LOBBY" && room ? renderLobby() : screen === "REVIEW" && room ? renderPoolReview() : screen === "GAME" && room ? renderGame() : screen === "RESULTS" && room ? renderResults() : <main className="workspace"><div className="panel-box center-box">Connecting to arena...</div></main>}</div>;
}
