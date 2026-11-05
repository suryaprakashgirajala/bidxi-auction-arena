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
  maxSquadSize: 18,
  bidIncrement: 0.5,
  timerSeconds: 12,
  botDifficulty: "MEDIUM",
  auctioneerMode: "AUTO",
  roomVisibility: "PRIVATE",
  teamMode: "IPL"
};

const CUSTOM_BADGES = ["★", "⚡", "🛡", "🔥", "🐯", "🦁", "🦅", "👑", "🏏", "💎", "🌪", "⚔"];
const CUSTOM_COLORS = ["#e0aa43", "#2d8ee5", "#e34d5c", "#8b65ce", "#1ca99a", "#e47a36", "#df5c9c", "#6b88a8", "#7e9e3e", "#7b5a44"];
function makeCustomDrafts(count) {
  return Array.from({ length: count }, (_, index) => ({
    name: `My Franchise ${index + 1}`,
    shortName: `MF${index + 1}`,
    color: CUSTOM_COLORS[index % CUSTOM_COLORS.length],
    badge: CUSTOM_BADGES[index % CUSTOM_BADGES.length]
  }));
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
  const [customTeamDrafts, setCustomTeamDrafts] = useState(() => makeCustomDrafts(DEFAULT_FORM.teamCount));
  const [joinForm, setJoinForm] = useState({ playerName: "", code: "" });
  const [message, setMessage] = useState("");
  const [chatText, setChatText] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTeam, setActiveTeam] = useState(null);
  const [publicRooms, setPublicRooms] = useState([]);
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
      setScreen(nextRoom.status === "LIVE" ? "GAME" : nextRoom.status === "COMPLETED" ? "RESULTS" : "LOBBY");
      setMessage("");
    });
    socket.on("room:state", (nextRoom) => {
      setRoom(nextRoom);
      if (nextRoom.status === "LIVE") setScreen("GAME");
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
    if (key === "teamCount") {
      setCustomTeamDrafts((drafts) => {
        const resized = [...drafts];
        while (resized.length < Number(value)) resized.push(makeCustomDrafts(resized.length + 1)[resized.length]);
        return resized.slice(0, Number(value));
      });
    }
    setForm((previous) => {
      const next = { ...previous, [key]: value };
      if (key === "teamCount") next.humanLimit = Math.min(Number(next.humanLimit), Number(value));
      if (key === "humanLimit") next.humanLimit = Math.min(Number(value), Number(previous.teamCount));
      return next;
    });
  };

  const updateCustomTeam = (index, key, value) => {
    setCustomTeamDrafts((drafts) => drafts.map((team, itemIndex) => itemIndex === index ? { ...team, [key]: value } : team));
  };

  const createRoom = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const result = await emit("room:create", {
      playerName: form.playerName,
      settings: {
        teamCount: Number(form.teamCount), humanLimit: Number(form.humanLimit),
        initialPurse: Number(form.initialPurse), maxSquadSize: Number(form.maxSquadSize),
        bidIncrement: Number(form.bidIncrement), timerSeconds: Number(form.timerSeconds),
        botDifficulty: form.botDifficulty, auctioneerMode: form.auctioneerMode,
        roomVisibility: form.roomVisibility, teamMode: form.teamMode
      },
      teamMode: form.teamMode,
      customTeams: form.teamMode === "CUSTOM" ? customTeamDrafts.slice(0, Number(form.teamCount)) : undefined
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
    const result = await emit("team:select", { teamId });
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
    else if (result.room) setRoom(result.room);
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

  const skipCurrentPlayer = async () => {
    if (!currentPlayer) return;
    const hasActiveBid = Boolean(room?.auction?.highestBidTeamId);
    const prompt = hasActiveBid
      ? `Skip ${currentPlayer.name}? This will mark the player UNSOLD and discard the current bid.`
      : `Skip ${currentPlayer.name} and mark this player UNSOLD?`;
    if (!window.confirm(prompt)) return;
    setBusy(true);
    setMessage("");
    const response = await emit("auction:skip");
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
  const myTurnToBid = Boolean(myTeam && room?.status === "LIVE" && room?.auction && !room.auction.paused && !room.auction.waitingForDecision && room.auction.highestBidTeamId !== myTeam.id && secondsLeft > 0 && myTeam.purse >= nextBid && myTeam.players.length < room.settings.maxSquadSize);
  const availableTeams = room?.teams?.filter((team) => !team.ownerId) || [];
  const claimedTeamCount = room?.teams?.filter((team) => Boolean(team.ownerId)).length || 0;
  const teamSelectionFull = Boolean(room && claimedTeamCount >= room.settings.teamCount);
  const selectionSeatsLeft = room ? Math.max(0, room.settings.teamCount - claimedTeamCount) : 0;
  const botCount = room ? room.teams.filter((team) => team.ownerType === "BOT").length : 0;
  const humanCount = room ? room.members.filter((member) => member.connected).length : 0;

  const renderHeader = () => (
    <header className="topbar">
      <div className="brand" role="button" tabIndex={0} onClick={() => room ? leaveRoom() : setScreen("HOME")} onKeyDown={(event) => event.key === "Enter" && (room ? leaveRoom() : setScreen("HOME"))}>
        <span className="brand-mark">A</span>
        <span><b>AUCTION</b><em>ARENA</em></span>
      </div>
      <div className="topbar-right">
        <span className={`connection-pill ${connection === "CONNECTED" ? "online" : "offline"}`}><i />{authLoading ? "RESTORING SESSION" : !account ? "LOGIN REQUIRED" : connection === "CONNECTED" ? "SERVER ONLINE" : connection === "CONNECTING" ? "CONNECTING" : "SERVER OFFLINE"}</span>
        {room && <span className="room-chip">ROOM <b>{room.code}</b></span>}
        {account && !room && <button className="account-nav" onClick={() => { setScreen("PROFILE"); loadProfile(); }}>MY ACCOUNT</button>}
        {account && <><span className="account-name">{account.displayName}</span><button className="logout-button" onClick={logout}>LOG OUT</button></>}
      </div>
    </header>
  );

  const renderAuth = () => (
    <main className="auth-wrap">
      <section className="auth-card">
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
          <div className="art-stat stat-right"><b>75+</b><span>PLAYERS</span></div>
        </div>
      </section>

      <section className="feature-strip">
        <div><span className="feature-icon">◈</span><b>REAL-TIME AUCTION</b><small>Every bid updates live</small></div>
        <div><span className="feature-icon">✦</span><b>SMART AI RIVALS</b><small>Strategic bot franchises</small></div>
        <div><span className="feature-icon">♜</span><b>FLEXIBLE TEAMS</b><small>Choose 2 to 10 franchises</small></div>
        <div><span className="feature-icon">⌂</span><b>PRIVATE ROOMS</b><small>Invite friends with a code</small></div>
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
                <div className="team-mode-picker">
                  <span className="field-caption">FRANCHISE STYLE</span>
                  <div className="mode-switch">
                    <button type="button" className={form.teamMode === "IPL" ? "active" : ""} onClick={() => updateForm("teamMode", "IPL")}>OFFICIAL IPL TEAMS</button>
                    <button type="button" className={form.teamMode === "CUSTOM" ? "active" : ""} onClick={() => updateForm("teamMode", "CUSTOM")}>CUSTOM FRANCHISES</button>
                  </div>
                  {form.teamMode === "IPL" ? (
                    <div className="mode-description">All 10 IPL franchises will be available in the lobby. Participants can choose any logo; the host's team-count setting controls how many franchises enter the auction.</div>
                  ) : (
                    <div className="custom-team-builder">
                      <div className="custom-builder-heading"><b>DESIGN YOUR FRANCHISES</b><small>Configure {form.teamCount} custom team identities.</small></div>
                      {customTeamDrafts.slice(0, Number(form.teamCount)).map((team, index) => (
                        <div className="custom-team-edit" key={`custom-${index}`}>
                          <span className="custom-team-badge" style={{ "--team-color": team.color }}>{team.badge}</span>
                          <div className="custom-team-fields">
                            <input aria-label={`Franchise ${index + 1} name`} required minLength="2" maxLength="28" value={team.name} onChange={(e) => updateCustomTeam(index, "name", e.target.value)} />
                            <div className="custom-team-subfields">
                              <input aria-label={`Franchise ${index + 1} short name`} required minLength="2" maxLength="5" value={team.shortName} onChange={(e) => updateCustomTeam(index, "shortName", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
                              <input aria-label={`Franchise ${index + 1} colour`} className="color-input" type="color" value={team.color} onChange={(e) => updateCustomTeam(index, "color", e.target.value)} />
                              <select aria-label={`Franchise ${index + 1} emblem`} value={team.badge} onChange={(e) => updateCustomTeam(index, "badge", e.target.value)}>{CUSTOM_BADGES.map((badge) => <option key={badge} value={badge}>{badge}</option>)}</select>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="form-row">
                  <label>Team purse<select value={form.initialPurse} onChange={(e) => updateForm("initialPurse", Number(e.target.value))}><option value="80">₹80 Cr</option><option value="100">₹100 Cr</option><option value="120">₹120 Cr</option><option value="150">₹150 Cr</option><option value="200">₹200 Cr</option></select></label>
                  <label>Squad size<select value={form.maxSquadSize} onChange={(e) => updateForm("maxSquadSize", Number(e.target.value))}><option value="11">11 players</option><option value="15">15 players</option><option value="18">18 players</option><option value="25">25 players</option></select></label>
                </div>
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
      <footer className="page-footer"><span>IPL AUCTION ARENA</span><span>BUILT FOR THE LOVE OF THE GAME.</span><span>75 PLAYER POOL · 10 FRANCHISE OPTIONS</span></footer>
    </main>
  );

  const renderLobby = () => (
    <main className="workspace">
      <div className="workspace-heading">
        <div><span className="eyebrow">PRE-AUCTION LOBBY</span><h1>Assemble your <span>franchises.</span></h1><p>{room.settings.teamMode === "CUSTOM" ? "Choose one of the custom franchises created for this room." : "Choose any available IPL franchise from the full team catalogue. The room creator's team limit decides how many enter the auction."} Unclaimed auction seats become AI opponents.</p></div>
        <button className="btn btn-ghost" onClick={leaveRoom}>LEAVE ROOM</button>
      </div>
      <section className="lobby-banner">
        <div><span className="mini-label">YOUR ROOM CODE</span><strong className="room-code">{room.code}</strong><small>Share this code with friends so they can join your auction.</small></div>
        <button className="btn btn-primary" onClick={copyCode}>{copied ? "COPIED ✓" : "COPY INVITE CODE"}</button>
        <div className="lobby-counts"><div><b>{humanCount}/{room.settings.humanLimit}</b><span>HUMANS</span></div><div><b>{room.settings.teamCount}</b><span>TEAMS</span></div><div><b>{room.settings.teamCount - humanCount}</b><span>AI AFTER START</span></div></div>
      </section>
      <div className="lobby-layout">
        <section className="panel-box">
          <div className="panel-heading"><div><span className="eyebrow">FRANCHISE DRAFT</span><h2>{room.settings.teamMode === "CUSTOM" ? "Choose your custom team" : "Choose any IPL franchise"}</h2></div><span className="muted-note">{availableTeams.length} open options · {selectionSeatsLeft} seats left</span></div>
          <div className="franchise-grid">
            {room.teams.map((team) => {
              const owner = room.members.find((member) => member.id === team.ownerId);
              const mine = team.ownerId === memberId;
              return <button key={team.id} className={`franchise-card ${mine ? "mine" : ""} ${team.ownerId && !mine ? "taken" : ""}`} style={{ "--team-color": team.color }} disabled={Boolean((team.ownerId && !mine) || (!team.ownerId && teamSelectionFull) || room.status !== "LOBBY")} onClick={() => mine ? unselectTeam() : chooseTeam(team.id)}>
                {team.logo ? <img src={team.logo} alt={`${team.name} logo`} onError={(e) => { e.currentTarget.style.display = "none"; }} /> : <span className="team-badge-logo" aria-hidden="true">{team.badge || initials(team.shortName)}</span>}
                <b>{team.shortName}</b><span>{team.name}</span>
                <small>{mine ? "YOUR FRANCHISE · CLICK TO RELEASE" : owner ? `PICKED BY ${owner.name}` : teamSelectionFull ? "ROOM TEAM LIMIT REACHED" : "AVAILABLE · SELECT"}</small>
              </button>;
            })}
          </div>
          <div className="lobby-note"><span>✦</span> Once the auction starts, the server assigns strategic AI owners to every unclaimed franchise.</div>
        </section>
        <aside className="lobby-side">
          <section className="panel-box participants-box">
            <div className="panel-heading"><div><span className="eyebrow">THE DRAFT ROOM</span><h2>Participants</h2></div><span className="count-badge">{humanCount}</span></div>
            {room.members.map((member) => {
              const team = room.teams.find((item) => item.id === member.teamId);
              return <div className="participant-row" key={member.id}><div className="avatar">{initials(member.name)}</div><div className="participant-meta"><b>{member.name}{member.id === room.hostMemberId && <em>HOST</em>}</b><small>{team ? team.shortName : "Choosing franchise..."}</small></div><span className={`status-tag ${member.connected ? "ready" : "away"}`}>{member.connected ? "ONLINE" : "AWAY"}</span></div>;
            })}
            <div className="bot-summary"><span className="bot-avatar">✦</span><div><b>{Math.max(0, room.settings.teamCount - room.teams.filter((team) => team.ownerType === "HUMAN").length)} AI seats will be filled</b><small>Unused IPL options remain outside this auction.</small></div></div>
          </section>
          <section className="panel-box settings-summary">
            <span className="eyebrow">AUCTION SETTINGS</span>
            <div className="setting-line"><span>Team style</span><b>{room.settings.teamMode === "CUSTOM" ? "Custom" : "IPL franchises"}</b></div>
            <div className="setting-line"><span>Starting purse</span><b>{formatCr(room.settings.initialPurse)}</b></div>
            <div className="setting-line"><span>Squad limit</span><b>{room.settings.maxSquadSize} players</b></div>
            <div className="setting-line"><span>Bot difficulty</span><b>{room.settings.botDifficulty}</b></div>
            <div className="setting-line"><span>Auctioneer</span><b>{room.settings.auctioneerMode}</b></div>
            {isHost ? <button className="btn btn-primary start-button" onClick={startAuction} disabled={busy || !myTeam}>{busy ? "STARTING..." : "START AUCTION →"}</button> : <div className="waiting-host">Waiting for the host to start the auction.</div>}
            {!myTeam && <div className="small-warning">Select a franchise before the host can start.</div>}
          </section>
        </aside>
      </div>
      {message && <div className="inline-alert workspace-alert">{message}</div>}
    </main>
  );

  const renderGame = () => {
    if (!currentPlayer) return <main className="workspace"><div className="panel-box center-box"><span className="eyebrow">AUCTION COMPLETE</span><h1>All players processed.</h1><button className="btn btn-primary" onClick={() => setScreen("RESULTS")}>VIEW FINAL SQUADS</button></div></main>;
    const timerPercent = room.settings.timerSeconds > 0 ? (secondsLeft / room.settings.timerSeconds) * 100 : 0;
    const leadingColor = highestTeam?.color || "#d9aa56";
    return (
      <main className="workspace game-workspace">
        <div className="game-topline"><div><span className={`live-dot ${room.auction.paused ? "paused-dot" : ""}`} /> {room.auction.paused ? "AUCTION PAUSED" : "LIVE AUCTION"} <span className="game-code">ROOM {room.code}</span></div><div className="game-progress">PLAYER <b>{room.auction.playerNumber}</b> / {room.auction.totalPlayers}</div><button className="btn btn-ghost btn-small" onClick={leaveRoom}>EXIT</button></div>
        <div className={`auction-control-bar ${room.auction.paused ? "is-paused" : ""}`}>
          <div className="auction-control-status"><span className="control-status-icon">{room.auction.paused ? "Ⅱ" : "●"}</span><div><b>{room.auction.paused ? "AUCTION ON HOLD" : "AUCTION IN PROGRESS"}</b><small>{room.auction.paused ? "Bidding and AI decisions are frozen until the host resumes." : "All participants are watching the same live auction."}</small></div></div>
          <div className="auction-control-actions">
            <button className="btn btn-skip" onClick={skipCurrentPlayer} disabled={busy || room.auction.paused || !currentPlayer || room.status !== "LIVE"}>SKIP PLAYER <span>↷</span></button>
            {isCreator && <button className="btn btn-pause" onClick={toggleAuctionPause} disabled={busy || !currentPlayer}>{busy ? "PLEASE WAIT" : room.auction.paused ? "RESUME AUCTION ▶" : "PAUSE AUCTION Ⅱ"}</button>}
            {isCreator && <button className="btn btn-end" onClick={endAuction} disabled={busy}>END AUCTION ■</button>}
          </div>
        </div>
        {room.auction.lastResult && <div key={`${room.auction.lastResult.playerName}-${room.auction.lastResult.status}-${room.auction.lastResult.amount || "skip"}`} className={`sale-banner ${room.auction.lastResult.status === "SOLD" ? "sold" : "unsold"}`}><b>{room.auction.lastResult.status}</b><span>{room.auction.lastResult.status === "SOLD" ? `${room.auction.lastResult.playerName} → ${room.auction.lastResult.teamName} for ${formatCr(room.auction.lastResult.amount)}` : room.auction.lastResult.skippedBy ? `${room.auction.lastResult.playerName} skipped by ${room.auction.lastResult.skippedBy}` : `${room.auction.lastResult.playerName} did not receive a bid`}</span></div>}
        <div className="game-grid">
          <section className="auction-stage panel-box">
            <div className="stage-top"><span className="eyebrow">NOW ON THE AUCTION BLOCK</span><span className="player-index">LOT #{String(room.auction.playerNumber).padStart(3, "0")}</span></div>
            <div className="player-showcase" key={currentPlayer.id}>
              <div className="player-photo-wrap"><img className="player-photo" src={currentPlayer.image} alt={currentPlayer.name} onError={(e) => { e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentPlayer.name)}&background=26354b&color=fff&size=420&bold=true`; }} /><span className="photo-ring" /></div>
              <div className="player-details"><span className="player-role">{currentPlayer.role.toUpperCase()}</span><h1>{currentPlayer.name}</h1><p>{currentPlayer.nationality || "Player"} · IPL PLAYER POOL</p><div className="base-price">BASE PRICE <b>{formatCr(currentPlayer.basePrice)}</b></div></div>
            </div>
            <div className="bid-display">
              <div className="bid-display-label">CURRENT HIGHEST BID</div>
              <div key={`${currentPlayer.id}-${room.auction.currentBid}`} className="bid-value" style={{ color: leadingColor }}>{formatCr(room.auction.currentBid || currentPlayer.basePrice)}</div>
              <div className="leading-team">{highestTeam ? <><span className="leading-dot" style={{ background: highestTeam.color }} /> {highestTeam.shortName} LEADS <small>· {highestTeam.ownerName}</small></> : <span>NO BIDS YET — MAKE THE OPENING BID</span>}</div>
              <div className={`timer-area ${room.auction.paused ? "timer-paused" : ""}`}><div className={`timer-number ${secondsLeft <= 5 && !room.auction.paused ? "urgent" : ""}`}>{room.auction.paused ? "Ⅱ" : room.auction.waitingForDecision ? "—" : String(secondsLeft).padStart(2, "0")}</div><div className="timer-track"><span style={{ width: `${Math.max(0, Math.min(100, timerPercent))}%` }} /></div><small>{room.auction.paused ? "TIMER FROZEN BY ROOM CREATOR" : room.auction.waitingForDecision ? "AWAITING AUCTIONEER DECISION" : "SECONDS LEFT TO BID"}</small></div>
            </div>
            <div className="bid-action-area">
              {myTeam ? <><div className="my-franchise-label"><span className="my-team-dot" style={{ background: myTeam.color }} /> YOU ARE BIDDING FOR <b>{myTeam.shortName}</b> · PURSE {formatCr(myTeam.purse)}</div><button className="btn btn-bid" disabled={!myTurnToBid || busy} onClick={placeBid}>{busy ? "PLACING BID..." : room.auction.highestBidTeamId === myTeam.id ? "YOU ARE LEADING" : `BID ${formatCr(nextBid)}`} <span>↗</span></button>{!myTurnToBid && !room.auction.waitingForDecision && <small className="bid-hint">{myTeam.purse < nextBid ? "Not enough purse for the next bid." : myTeam.players.length >= room.settings.maxSquadSize ? "Your squad is full." : room.auction.highestBidTeamId === myTeam.id ? "Wait for another franchise to challenge your bid." : "Bidding is closed."}</small>}</> : <div className="spectator-hint">You are watching this auction as a spectator.</div>}
              {isHost && room.settings.auctioneerMode === "MANUAL" && room.auction.waitingForDecision && <div className="auctioneer-controls"><span>AUCTIONEER DECISION</span><div><button className="btn btn-sold" onClick={() => auctioneerDecision("SOLD")} disabled={!highestTeam || busy}>SOLD</button><button className="btn btn-unsold" onClick={() => auctioneerDecision("UNSOLD")} disabled={busy}>UNSOLD</button></div></div>}
            </div>
          </section>
          <aside className="side-stack">
            <section className="panel-box team-board"><div className="panel-heading"><div><span className="eyebrow">FRANCHISES</span><h2>Team purse</h2></div><span className="count-badge">{room.teams.length}</span></div><div className="team-list">{room.teams.map((team) => <button key={team.id} className={`team-row ${team.id === room.auction.highestBidTeamId ? "team-leading" : ""} ${team.id === myTeam?.id ? "team-mine" : ""}`} onClick={() => setActiveTeam(activeTeam === team.id ? null : team.id)}><span className="team-color-bar" style={{ background: team.color }} />{team.logo ? <span className="team-inline-emblem"><img src={team.logo} alt="" /></span> : <span className="team-inline-emblem custom" style={{ "--team-color": team.color }}>{team.badge || initials(team.shortName)}</span>}<span className="team-short">{team.shortName}</span><span className="team-owner">{team.ownerType === "BOT" ? "AI BOT" : team.ownerName}</span><span className="team-purse">{formatCr(team.purse).replace(" Cr", "")}</span><span className="team-count">{team.players.length}</span></button>)}</div><div className="team-board-legend"><span><i className="legend-human" /> HUMAN</span><span><i className="legend-bot" /> AI FRANCHISE</span><span>PLAYERS</span></div></section>
            {activeTeam && <section className="panel-box selected-squad"><div className="panel-heading"><div><span className="eyebrow">FRANCHISE SQUAD</span><h2>{room.teams.find((team) => team.id === activeTeam)?.shortName}</h2></div><button className="close-mini" onClick={() => setActiveTeam(null)}>×</button></div>{room.teams.find((team) => team.id === activeTeam)?.players.length ? room.teams.find((team) => team.id === activeTeam).players.map((player) => <div className="squad-line" key={player.id}><span>{player.name}<small>{player.role}</small></span><b>{formatCr(player.finalPrice)}</b></div>) : <div className="empty-squad">No players purchased yet.</div>}</section>}
            <section className="panel-box activity-panel"><div className="panel-heading"><div><span className="eyebrow">LIVE FEED</span><h2>Auction activity</h2></div></div><div className="activity-list">{[...(room.auction.history || [])].slice(-7).reverse().map((item) => <div className={`activity-item ${item.type.toLowerCase()}`} key={item.id}><i /> <div><p>{item.message}</p><small>{formatTime(item.at)}</small></div></div>)}</div></section>
            <section className="panel-box chat-panel"><div className="panel-heading"><div><span className="eyebrow">ROOM SOCIAL</span><h2>Live chat</h2></div></div><div className="chat-messages">{(room.chat || []).slice(-18).map((item) => <div className={`chat-message ${item.system ? "system" : ""}`} key={item.id}><div><b>{item.name}</b><small>{formatTime(item.at)}</small></div><p>{item.text}</p></div>)}<div ref={chatEndRef} /></div><form className="chat-compose" onSubmit={sendChat}><input maxLength="240" value={chatText} onChange={(e) => setChatText(e.target.value)} placeholder="Message your room..." /><button type="submit" disabled={!chatText.trim()}>SEND</button></form></section>
          </aside>
        </div>
        {message && <div className="inline-alert workspace-alert">{message}</div>}
        <div className="game-bottom"><div><b>PLAY SMART. BID SMARTER.</b><span>Every franchise has the same rules, whether owned by a friend or AI.</span></div><span>{botCount} AI RIVALS · {humanCount} HUMAN PLAYERS</span></div>
      </main>
    );
  };

  const renderResults = () => {
    const soldPlayers = room.teams.reduce((sum, team) => sum + team.players.length, 0);
    const totalSpent = room.teams.reduce((sum, team) => sum + team.spent, 0);
    const sortedTeams = [...room.teams].sort((a, b) => b.spent - a.spent);
    return <main className="workspace results-workspace"><div className="results-hero"><span className="eyebrow">THE HAMMER HAS FALLEN</span><h1>AUCTION <span>{room.auction?.endedEarly ? "ENDED." : "COMPLETE."}</span></h1><p>{room.auction?.endedEarly ? "The host closed the auction early. Every franchise squad is shown below." : "All players have been processed. Every franchise squad is shown below."}</p><div className="results-stats"><div><b>{soldPlayers}</b><span>PLAYERS SOLD</span></div><div><b>{Math.max(0, (room.auction?.completedCount || 0) - soldPlayers)}</b><span>UNSOLD / SKIPPED</span></div><div><b>{formatCr(totalSpent)}</b><span>TOTAL SPENT</span></div><div><b>{Math.max(0, (room.auction?.totalPlayers || 0) - (room.auction?.completedCount || 0))}</b><span>NOT PROCESSED</span></div></div></div>
      <div className="results-heading"><div><span className="eyebrow">FINAL FRANCHISE RANKINGS</span><h2>Squad room</h2></div><button className="btn btn-ghost" onClick={leaveRoom}>BACK TO HOME</button></div>
      <div className="results-grid">{sortedTeams.map((team, index) => <article className="result-team-card" key={team.id} style={{ "--team-color": team.color }}><div className="result-team-head"><span className="rank">#{index + 1}</span><span className="result-team-emblem" style={{ "--team-color": team.color }}>{team.logo ? <img src={team.logo} alt="" /> : (team.badge || initials(team.shortName))}</span><div><b>{team.name || team.shortName}</b><small>{team.shortName} · {team.ownerType === "BOT" ? "AI FRANCHISE" : team.ownerName}</small></div><span className="spent-total">{formatCr(team.spent)}</span></div><div className="result-team-metrics"><span>{team.players.length} PLAYERS</span><span>{formatCr(team.purse)} LEFT</span></div><div className="result-squad-list">{team.players.length ? team.players.map((player) => <div key={player.id}><span>{player.name}<small>{player.role}</small></span><b>{formatCr(player.finalPrice)}</b></div>) : <p>No players purchased.</p>}</div></article>)}</div>
      <div className="results-actions"><button className="btn btn-primary" onClick={leaveRoom}>CREATE ANOTHER AUCTION →</button></div>
    </main>;
  };

  return <div className="app-shell">{renderHeader()}{authLoading ? <main className="workspace"><div className="panel-box center-box">Restoring your account session...</div></main> : !account ? renderAuth() : screen === "PROFILE" ? renderProfile() : screen === "HOME" ? renderHome() : screen === "LOBBY" && room ? renderLobby() : screen === "GAME" && room ? renderGame() : screen === "RESULTS" && room ? renderResults() : <main className="workspace"><div className="panel-box center-box">Connecting to arena...</div></main>}</div>;
}
