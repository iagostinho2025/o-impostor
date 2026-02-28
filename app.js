
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  get,
  update,
  remove,
  runTransaction,
  onDisconnect,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import { firebaseConfig } from "./firebase-config.js";
import { getRandomWord, getLevel3Hint } from "./word-bank.js";

const appEl = document.getElementById("app");

const state = {
  uid: null,
  roomCode: null,
  roomData: null,
  nickname: "",
  homeTab: "home",
  error: "",
  loading: false,
  countdownLeft: 5,
  countdownTimer: null,
  scheduledReveal: null,
  roomUnsub: null,
  disconnectRef: null,
  copyFeedback: false,
  copyFeedbackTimer: null,
  lastPhase: null,
  friends: {},
  incomingRequests: {},
  profiles: {},
  presence: {},
  socialUnsubs: [],
  socialEntityUnsubs: [],
  socialEntityKey: "",
  presenceRef: null,
  statsUnsub: null,
  userStats: null,
  recordingStats: false,
  recordedRounds: {},
  friendCodeInput: "",
  connectedUnsub: null,
  showRoomSettings: false
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
const auth = getAuth(firebaseApp);
const AVATAR_OPTIONS = ["🧑‍🎤", "👨‍🚀", "👩‍⚕️", "👨‍💼", "👩‍💻", "👨‍🍳", "👩‍🎨", "👨‍🔧", "👩‍🚒", "👨‍🎓", "👩‍🏫", "👨‍✈️"];
const CARD_COLOR_OPTIONS = ["#6C63FF", "#FF6B6B", "#22C55E", "#0EA5E9", "#F59E0B", "#EC4899", "#14B8A6", "#A855F7", "#F97316", "#3B82F6", "#84CC16", "#E11D48"];
const HUB_TABS = [
  { id: "home", icon: "🏠", label: "Home" },
  { id: "games", icon: "🎮", label: "Jogos" },
  { id: "rooms", icon: "🚪", label: "Salas" },
  { id: "friends", icon: "👥", label: "Amigos" },
  { id: "profile", icon: "✨", label: "Perfil" }
];
const NICKNAME_PREF_KEY = "impostor_nickname";
const ROOM_SESSION_KEY = "impostor_last_room";

state.avatar = AVATAR_OPTIONS[0];
state.cardColor = CARD_COLOR_OPTIONS[0];
try {
  const savedNickname = localStorage.getItem(NICKNAME_PREF_KEY);
  if (savedNickname) {
    state.nickname = savedNickname.slice(0, 16);
  }
} catch {
  // no-op
}

async function authenticateAnonymously() {
  try {
    await signInAnonymously(auth);
  } catch (error) {
    const message = error?.message || "Não foi possível autenticar no Firebase.";
    setError(`Falha de autenticação: ${message}`);
  }
}

function escapeHtml(text = "") {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getPlayerAvatar(player) {
  return player?.avatar || "🕵️";
}

function getPlayerColor(player) {
  return player?.cardColor || "#6C63FF";
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace("#", "");
  const chunk = clean.length === 3
    ? clean.split("").map((c) => `${c}${c}`).join("")
    : clean;
  const value = Number.parseInt(chunk, 16);
  if (Number.isNaN(value)) return `rgba(108,99,255,${alpha})`;
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function generateRoomCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickAvailableOption(preferred, options, usedSet) {
  if (!usedSet.has(preferred)) return preferred;
  const fallback = options.find((opt) => !usedSet.has(opt));
  return fallback || preferred;
}

function getPlayers(roomData = state.roomData) {
  return Object.values(roomData?.players || {});
}

function getPlayerById(id, roomData = state.roomData) {
  return roomData?.players?.[id] || null;
}

function isHost() {
  return state.roomData?.hostId === state.uid;
}

function myPlayer() {
  return state.roomData?.players?.[state.uid] || null;
}

function getImpostorIds(roomData = state.roomData) {
  const fromArray = Array.isArray(roomData?.impostorIds) ? roomData.impostorIds.filter(Boolean) : [];
  if (fromArray.length > 0) return fromArray;
  const legacy = roomData?.impostorId || "";
  return legacy ? [legacy] : [];
}

function getMaxImpostorCount(playersCount) {
  return Math.max(1, Math.min(3, playersCount - 1));
}

function getRoomSettings(roomData = state.roomData) {
  const playersCount = Object.keys(roomData?.players || {}).length;
  const maxImpostors = getMaxImpostorCount(playersCount || 3);
  const configured = Number(roomData?.impostorCount) || 1;
  return {
    level3HintEnabled: roomData?.level3HintEnabled !== false,
    impostorCount: Math.max(1, Math.min(configured, maxImpostors))
  };
}

function setError(message) {
  state.error = message || "";
  render();
}

function clearError() {
  state.error = "";
}

function saveNicknameLocally(nickname) {
  try {
    localStorage.setItem(NICKNAME_PREF_KEY, nickname);
  } catch {
    // no-op
  }
}

function saveRoomSession(roomCode) {
  try {
    if (roomCode) {
      localStorage.setItem(ROOM_SESSION_KEY, roomCode);
      return;
    }
    localStorage.removeItem(ROOM_SESSION_KEY);
  } catch {
    // no-op
  }
}

function getSavedRoomSession() {
  try {
    const code = (localStorage.getItem(ROOM_SESSION_KEY) || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 4);
    return code.length === 4 ? code : "";
  } catch {
    return "";
  }
}

function myDisplayName() {
  const localNick = state.nickname.trim();
  if (localNick.length >= 2) return localNick;
  const roomNick = myPlayer()?.nickname?.trim() || "";
  if (roomNick.length >= 2) return roomNick;
  return "Jogador";
}

function clearSocialSubscriptions() {
  state.socialUnsubs.forEach((unsub) => {
    try {
      unsub();
    } catch {
      // no-op
    }
  });
  state.socialUnsubs = [];
  state.socialEntityUnsubs.forEach((unsub) => {
    try {
      unsub();
    } catch {
      // no-op
    }
  });
  state.socialEntityUnsubs = [];
  state.socialEntityKey = "";
}

function clearStatsSubscription() {
  if (state.statsUnsub) {
    try {
      state.statsUnsub();
    } catch {
      // no-op
    }
    state.statsUnsub = null;
  }
  state.userStats = null;
}

function subscribeMyStats() {
  if (!state.uid) return;
  clearStatsSubscription();
  state.statsUnsub = onValue(ref(db, `userStats/${state.uid}`), (snap) => {
    state.userStats = snap.val() || null;
    render();
  });
}

function getRoundResult(roomData = state.roomData) {
  const players = Object.values(roomData?.players || {});
  const impostorIds = getImpostorIds(roomData);
  if (impostorIds.length === 0 || players.length === 0) return null;

  const votes = {};
  players.forEach((p) => { votes[p.id] = 0; });
  players.forEach((p) => {
    if (p.vote) votes[p.vote] = (votes[p.vote] || 0) + 1;
  });

  const maxVotes = Math.max(...Object.values(votes), 0);
  const mostVoted = players.filter((p) => votes[p.id] === maxVotes && maxVotes > 0);
  const isTie = mostVoted.length > 1;
  const impostorHit = !isTie && mostVoted.length === 1 && impostorIds.includes(mostVoted[0].id);
  const meIsImpostor = impostorIds.includes(state.uid);
  const won = meIsImpostor ? !impostorHit : impostorHit;
  return { won };
}

function currentRoundKey(roomData = state.roomData) {
  if (!state.roomCode || !roomData) return "";
  const createdAt = roomData.createdAt || 0;
  const countdownEndsAt = roomData.countdownEndsAt || 0;
  const impostorIds = getImpostorIds(roomData).sort().join(",");
  return `${state.roomCode}:${createdAt}:${countdownEndsAt}:${impostorIds}`;
}

async function maybeRecordRoundStats() {
  if (!state.uid || !state.roomData || state.roomData.status !== "reveal") return;
  const roundKey = currentRoundKey();
  if (!roundKey || state.recordedRounds[roundKey] || state.recordingStats) return;

  const result = getRoundResult();
  if (!result) return;

  state.recordingStats = true;
  try {
    const statsRef = ref(db, `userStats/${state.uid}`);
    const tx = await runTransaction(statsRef, (current) => {
      const stats = current || {};
      const rounds = stats.rounds || {};
      if (rounds[roundKey]) return stats;

      const games = Number(stats.games) || 0;
      const wins = Number(stats.wins) || 0;
      return {
        games: games + 1,
        wins: wins + (result.won ? 1 : 0),
        updatedAt: Date.now(),
        rounds: {
          ...rounds,
          [roundKey]: true
        }
      };
    }, { applyLocally: false });

    if (tx.committed) {
      state.recordedRounds[roundKey] = true;
    }
  } catch {
    // no-op
  } finally {
    state.recordingStats = false;
  }
}

function syncSocialEntitySubscriptions() {
  if (!state.uid) return;
  const friendIds = Object.keys(state.friends || {}).sort();
  const nextKey = friendIds.join("|");
  if (nextKey === state.socialEntityKey) return;

  state.socialEntityUnsubs.forEach((unsub) => {
    try {
      unsub();
    } catch {
      // no-op
    }
  });
  state.socialEntityUnsubs = [];
  state.socialEntityKey = nextKey;
  state.profiles = {};
  state.presence = {};

  if (friendIds.length === 0) {
    render();
    return;
  }

  friendIds.forEach((friendUid) => {
    state.socialEntityUnsubs.push(onValue(ref(db, `userProfiles/${friendUid}`), (snap) => {
      if (snap.exists()) {
        state.profiles[friendUid] = snap.val();
      } else {
        delete state.profiles[friendUid];
      }
      render();
    }));

    state.socialEntityUnsubs.push(onValue(ref(db, `userPresence/${friendUid}`), (snap) => {
      if (snap.exists()) {
        state.presence[friendUid] = snap.val();
      } else {
        delete state.presence[friendUid];
      }
      render();
    }));
  });
}

async function clearPresenceHook() {
  if (!state.presenceRef) return;
  await onDisconnect(state.presenceRef).cancel();
  state.presenceRef = null;
}

async function upsertUserProfile() {
  if (!state.uid) return;
  await update(ref(db, `userProfiles/${state.uid}`), {
    nickname: myDisplayName(),
    updatedAt: Date.now()
  });
}

async function propagateNicknameToFriends() {
  if (!state.uid) return;
  const newNick = myDisplayName();
  const friendsSnap = await get(ref(db, `friends/${state.uid}`));
  if (!friendsSnap.exists()) return;

  const friendsMap = friendsSnap.val() || {};
  const updates = {};
  Object.keys(friendsMap).forEach((friendUid) => {
    updates[`friends/${friendUid}/${state.uid}/nickname`] = newNick;
  });
  if (Object.keys(updates).length > 0) {
    await update(ref(db), updates);
  }
}

async function attachUserPresence() {
  if (!state.uid) return;
  const presenceRef = ref(db, `userPresence/${state.uid}`);
  state.presenceRef = presenceRef;
  await onDisconnect(presenceRef).update({
    online: false,
    lastSeenAt: serverTimestamp(),
    roomCode: ""
  });
  await update(presenceRef, {
    online: true,
    roomCode: state.roomCode || "",
    lastSeenAt: Date.now()
  });
}

function stopConnectionPresenceSync() {
  if (state.connectedUnsub) {
    try {
      state.connectedUnsub();
    } catch {
      // no-op
    }
    state.connectedUnsub = null;
  }
}

function startConnectionPresenceSync() {
  if (!state.uid) return;
  stopConnectionPresenceSync();

  const connectedRef = ref(db, ".info/connected");
  state.connectedUnsub = onValue(connectedRef, async (snap) => {
    if (!state.uid || snap.val() !== true) return;
    const presenceRef = ref(db, `userPresence/${state.uid}`);
    state.presenceRef = presenceRef;
    try {
      await onDisconnect(presenceRef).update({
        online: false,
        roomCode: "",
        lastSeenAt: serverTimestamp()
      });
      await update(presenceRef, {
        online: true,
        roomCode: state.roomCode || "",
        lastSeenAt: Date.now()
      });
      if (state.roomCode) {
        await attachPresence(state.roomCode);
      }
    } catch {
      // no-op
    }
  });
}

function subscribeSocialData() {
  if (!state.uid) return;
  clearSocialSubscriptions();

  const unsubs = [];
  unsubs.push(onValue(ref(db, `friends/${state.uid}`), (snap) => {
    state.friends = snap.val() || {};
    syncSocialEntitySubscriptions();
    render();
  }));
  unsubs.push(onValue(ref(db, `friendRequests/${state.uid}`), (snap) => {
    state.incomingRequests = snap.val() || {};
    render();
  }));
  state.socialUnsubs = unsubs;
}

async function sendFriendRequest(targetUidRaw) {
  if (!state.uid) throw new Error("Você precisa estar conectado.");
  const targetUid = targetUidRaw.trim();
  if (!targetUid || targetUid.length < 6) throw new Error("Informe um ID válido.");
  if (targetUid === state.uid) throw new Error("Você não pode adicionar a si mesmo.");
  if (state.friends?.[targetUid]) throw new Error("Esse usuário já está na sua lista.");

  const requestRef = ref(db, `friendRequests/${targetUid}/${state.uid}`);
  const payload = {
    fromUid: state.uid,
    fromNickname: myDisplayName(),
    createdAt: Date.now(),
    status: "pending"
  };

  const tx = await runTransaction(requestRef, (current) => current || payload, { applyLocally: false });
  if (!tx.committed) throw new Error("Pedido já enviado.");
}

async function acceptFriendRequest(fromUid) {
  if (!state.uid) throw new Error("Você precisa estar conectado.");
  const requestSnap = await get(ref(db, `friendRequests/${state.uid}/${fromUid}`));
  if (!requestSnap.exists()) throw new Error("Pedido não encontrado.");

  const requestData = requestSnap.val() || {};
  const myNick = myDisplayName();
  const now = Date.now();
  const updates = {};
  updates[`friends/${state.uid}/${fromUid}`] = {
    uid: fromUid,
    nickname: requestData.fromNickname || (state.profiles?.[fromUid]?.nickname || "Jogador"),
    addedAt: now
  };
  updates[`friends/${fromUid}/${state.uid}`] = {
    uid: state.uid,
    nickname: myNick,
    addedAt: now
  };
  updates[`friendRequests/${state.uid}/${fromUid}`] = null;
  await update(ref(db), updates);
}

async function rejectFriendRequest(fromUid) {
  if (!state.uid) throw new Error("Você precisa estar conectado.");
  await remove(ref(db, `friendRequests/${state.uid}/${fromUid}`));
}

async function removeFriend(friendUid) {
  if (!state.uid) throw new Error("Você precisa estar conectado.");
  if (!friendUid) throw new Error("Amigo inválido.");

  const updates = {};
  updates[`friends/${state.uid}/${friendUid}`] = null;
  updates[`friends/${friendUid}/${state.uid}`] = null;
  updates[`friendRequests/${state.uid}/${friendUid}`] = null;
  updates[`friendRequests/${friendUid}/${state.uid}`] = null;
  await update(ref(db), updates);
}

function clearRoomSubscription() {
  if (state.roomUnsub) {
    state.roomUnsub();
    state.roomUnsub = null;
  }
}

async function clearDisconnectHook() {
  if (state.disconnectRef) {
    await onDisconnect(state.disconnectRef).cancel();
    state.disconnectRef = null;
  }
}

async function attachPresence(roomCode) {
  const playerRef = ref(db, `rooms/${roomCode}/players/${state.uid}`);
  state.disconnectRef = playerRef;
  await onDisconnect(playerRef).update({
    connected: false,
    lastSeenAt: serverTimestamp()
  });
  await update(playerRef, {
    lastSeenAt: serverTimestamp(),
    connected: true
  });
  if (state.uid) {
    try {
      await update(ref(db, `userPresence/${state.uid}`), {
        online: true,
        roomCode: roomCode || "",
        lastSeenAt: Date.now()
      });
    } catch {
      // no-op
    }
  }
}

async function subscribeToRoom(code) {
  clearRoomSubscription();
  state.roomCode = code;
  saveRoomSession(code);
  state.roomUnsub = onValue(ref(db, `rooms/${code}`), async (snap) => {
    const data = snap.val();
    if (!data) {
      await leaveLocalRoom();
      return;
    }

    state.roomData = data;
    maybeRunCountdown();
    await maybeAutoAdvancePhase();
    await maybeRecoverHost();
    await maybeRecordRoundStats();
    render();
  });
}

async function maybeAutoAdvancePhase() {
  if (!isHost() || !state.roomData) return;

  const players = getPlayers();
  if (players.length === 0) return;

  if (state.roomData.status === "revealing" && players.every((p) => p.confirmed)) {
    await update(ref(db, `rooms/${state.roomCode}`), { status: "playing" });
  }

  if (state.roomData.status === "voting" && players.every((p) => !!p.vote)) {
    await update(ref(db, `rooms/${state.roomCode}`), { status: "results" });
  }
}

async function leaveLocalRoom() {
  clearRoomSubscription();
  clearInterval(state.countdownTimer);
  state.countdownTimer = null;
  state.scheduledReveal = null;
  clearTimeout(state.copyFeedbackTimer);
  state.copyFeedbackTimer = null;
  state.copyFeedback = false;
  await clearDisconnectHook();
  state.roomCode = null;
  saveRoomSession("");
  state.roomData = null;
  state.showRoomSettings = false;
  state.homeTab = "home";
  state.loading = false;
  if (state.uid) {
    try {
      await update(ref(db, `userPresence/${state.uid}`), {
        online: true,
        roomCode: "",
        lastSeenAt: Date.now()
      });
    } catch {
      // no-op
    }
  }
  render();
}

async function maybeRecoverHost() {
  const room = state.roomData;
  if (!room) return;

  const players = getPlayers(room);
  if (players.length === 0) return;
  if (room.players?.[room.hostId]) return;

  const ordered = players.slice().sort((a, b) => a.joinedAt - b.joinedAt);
  const nextHost = ordered[0];
  if (!nextHost) return;

  await runTransaction(ref(db, `rooms/${state.roomCode}`), (current) => {
    if (!current || (current.hostId && current.players?.[current.hostId])) {
      return current;
    }

    current.hostId = nextHost.id;
    if (current.players?.[nextHost.id]) {
      current.players[nextHost.id].isHost = true;
    }
    return current;
  }, { applyLocally: false });
}

function maybeRunCountdown() {
  const status = state.roomData?.status;
  const endsAt = state.roomData?.countdownEndsAt || 0;

  if (status !== "countdown" || !endsAt) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
    state.countdownLeft = 5;
    return;
  }

  const tick = async () => {
    const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    state.countdownLeft = left;
    render();

    if (left <= 0 && isHost()) {
      if (state.scheduledReveal === endsAt) return;
      state.scheduledReveal = endsAt;

      await runTransaction(ref(db, `rooms/${state.roomCode}/status`), (current) => {
        if (current === "countdown") return "revealing";
        return current;
      }, { applyLocally: false });
    }
  };

  if (!state.countdownTimer) {
    state.countdownTimer = setInterval(tick, 250);
  }

  tick();
}

async function createRoom(nickname) {
  if (!state.uid) {
    throw new Error("Conectando ao servidor. Tente novamente.");
  }
  const safeNick = nickname.trim();
  if (safeNick.length < 2 || safeNick.length > 16) {
    throw new Error("Apelido inválido.");
  }

  for (let i = 0; i < 10; i += 1) {
    const code = generateRoomCode();
    const roomRef = ref(db, `rooms/${code}`);
    const room = {
      code,
      hostId: state.uid,
      status: "lobby",
      createdAt: Date.now(),
      countdownEndsAt: 0,
      word: "",
      impostorId: "",
      impostorIds: [],
      level3HintEnabled: true,
      impostorCount: 1,
      speakingOrder: [],
      players: {
        [state.uid]: {
          id: state.uid,
          nickname: safeNick,
          avatar: state.avatar,
          cardColor: state.cardColor,
          isHost: true,
          confirmed: false,
          vote: "",
          joinedAt: Date.now(),
          connected: true,
          lastSeenAt: Date.now()
        }
      }
    };

    const tx = await runTransaction(roomRef, (current) => {
      if (current === null) return room;
      return;
    }, { applyLocally: false });

    if (tx.committed) {
      await subscribeToRoom(code);
      await attachPresence(code);
      return;
    }
  }

  throw new Error("Não foi possível criar uma sala única. Tente novamente.");
}

async function joinRoom(nickname, roomCodeRaw) {
  if (!state.uid) {
    throw new Error("Conectando ao servidor. Tente novamente.");
  }
  const safeNick = nickname.trim();
  const roomCode = roomCodeRaw.trim().toUpperCase();

  if (safeNick.length < 2 || safeNick.length > 16) {
    throw new Error("Apelido inválido.");
  }
  if (roomCode.length !== 4) {
    throw new Error("Código da sala inválido.");
  }

  const roomSnap = await get(ref(db, `rooms/${roomCode}`));
  if (!roomSnap.exists()) {
    throw new Error("Sala não encontrada.");
  }

  const roomData = roomSnap.val();
  const alreadyInsideRoom = !!roomData?.players?.[state.uid];
  if (roomData.status !== "lobby" && !alreadyInsideRoom) {
    throw new Error("Partida já em andamento.");
  }
  if (alreadyInsideRoom) {
    await subscribeToRoom(roomCode);
    await attachPresence(roomCode);
    return;
  }

  let joinError = "Não foi possível entrar na sala.";
  const playersRef = ref(db, `rooms/${roomCode}/players`);
  const tx = await runTransaction(playersRef, (currentPlayers) => {
    const players = currentPlayers || {};
    const ids = Object.keys(players);
    const alreadyInside = !!players[state.uid];

    if (!alreadyInside && ids.length >= 8) {
      joinError = "Sala cheia (máximo 8 jogadores).";
      return currentPlayers;
    }

    const takenAvatars = new Set(
      Object.values(players)
        .filter((p) => p.id !== state.uid)
        .map((p) => p.avatar)
        .filter(Boolean)
    );
    const takenColors = new Set(
      Object.values(players)
        .filter((p) => p.id !== state.uid)
        .map((p) => p.cardColor)
        .filter(Boolean)
    );
    const safeAvatar = pickAvailableOption(state.avatar, AVATAR_OPTIONS, takenAvatars);
    const safeCardColor = pickAvailableOption(state.cardColor, CARD_COLOR_OPTIONS, takenColors);

    return {
      ...players,
      [state.uid]: {
        id: state.uid,
        nickname: safeNick,
        avatar: safeAvatar,
        cardColor: safeCardColor,
        isHost: roomData.hostId === state.uid,
        confirmed: false,
        vote: "",
        joinedAt: Date.now(),
        connected: true,
        lastSeenAt: Date.now()
      }
    };
  }, { applyLocally: false });

  if (!tx.committed) throw new Error(joinError);
  const joined = tx.snapshot?.val()?.[state.uid];
  if (joined?.avatar) state.avatar = joined.avatar;
  if (joined?.cardColor) state.cardColor = joined.cardColor;

  await subscribeToRoom(roomCode);
  await attachPresence(roomCode);
}

async function updateLobbyProfile(change) {
  if (!state.uid) throw new Error("Conectando ao servidor. Tente novamente.");
  if (!state.roomCode || !state.uid) throw new Error("Sala não encontrada.");

  const playersRef = ref(db, `rooms/${state.roomCode}/players`);
  let conflictMessage = "";

  const tx = await runTransaction(playersRef, (currentPlayers) => {
    const players = currentPlayers || {};
    const me = players[state.uid];
    if (!me) return;

    if (change.avatar) {
      const avatarTaken = Object.values(players).some(
        (p) => p.id !== state.uid && p.avatar === change.avatar
      );
      if (avatarTaken) {
        conflictMessage = "Esse avatar já está em uso.";
        return;
      }
    }

    if (change.cardColor) {
      const colorTaken = Object.values(players).some(
        (p) => p.id !== state.uid && p.cardColor === change.cardColor
      );
      if (colorTaken) {
        conflictMessage = "Essa cor já está em uso.";
        return;
      }
    }

    players[state.uid] = {
      ...me,
      ...(change.avatar ? { avatar: change.avatar } : {}),
      ...(change.cardColor ? { cardColor: change.cardColor } : {}),
      lastSeenAt: Date.now()
    };
    return players;
  }, { applyLocally: false });

  if (!tx.committed) {
    throw new Error(conflictMessage || "Não foi possível atualizar seu perfil.");
  }

  const me = tx.snapshot?.val()?.[state.uid];
  if (me?.avatar) state.avatar = me.avatar;
  if (me?.cardColor) state.cardColor = me.cardColor;
}

async function updateRoomSettings(change) {
  if (!isHost()) throw new Error("Somente o anfitrião pode alterar configurações.");
  if (!state.roomCode || !state.roomData) throw new Error("Sala não encontrada.");
  if (state.roomData.status !== "lobby") throw new Error("As configurações só podem ser alteradas no lobby.");

  const playersCount = getPlayers().length;
  const maxImpostors = getMaxImpostorCount(playersCount);
  const nextHintEnabled = typeof change.level3HintEnabled === "boolean"
    ? change.level3HintEnabled
    : getRoomSettings().level3HintEnabled;
  const nextImpostorCountRaw = Number.isInteger(change.impostorCount)
    ? change.impostorCount
    : getRoomSettings().impostorCount;
  const nextImpostorCount = Math.max(1, Math.min(nextImpostorCountRaw, maxImpostors));

  await update(ref(db, `rooms/${state.roomCode}`), {
    level3HintEnabled: nextHintEnabled,
    impostorCount: nextImpostorCount
  });
}

async function tryResumeRoomSession() {
  if (!state.uid || state.roomCode) return false;
  const savedCode = getSavedRoomSession();
  if (!savedCode) return false;

  try {
    const roomSnap = await get(ref(db, `rooms/${savedCode}`));
    if (!roomSnap.exists()) {
      saveRoomSession("");
      return false;
    }

    const roomData = roomSnap.val() || {};
    if (!roomData.players?.[state.uid]) {
      saveRoomSession("");
      return false;
    }

    await subscribeToRoom(savedCode);
    await attachPresence(savedCode);
    return true;
  } catch {
    return false;
  }
}

async function startGame() {
  if (!isHost()) throw new Error("Somente o anfitrião pode iniciar.");

  const players = getPlayers();
  if (players.length < 3) throw new Error("Minimo de 3 jogadores.");

  const word = getRandomWord();
  const { impostorCount } = getRoomSettings();
  const shuffledIds = shuffleArray(players.map((p) => p.id));
  const chosenCount = Math.min(impostorCount, getMaxImpostorCount(players.length));
  const impostorIds = shuffledIds.slice(0, chosenCount);
  const impostorId = impostorIds[0] || "";
  const speakingOrder = shuffleArray(players.map((p) => p.id));
  const updates = {};

  players.forEach((p) => {
    updates[`rooms/${state.roomCode}/players/${p.id}/confirmed`] = false;
    updates[`rooms/${state.roomCode}/players/${p.id}/vote`] = "";
  });

  updates[`rooms/${state.roomCode}/status`] = "countdown";
  updates[`rooms/${state.roomCode}/word`] = word;
  updates[`rooms/${state.roomCode}/impostorId`] = impostorId;
  updates[`rooms/${state.roomCode}/impostorIds`] = impostorIds;
  updates[`rooms/${state.roomCode}/speakingOrder`] = speakingOrder;
  updates[`rooms/${state.roomCode}/countdownEndsAt`] = Date.now() + 5000;

  await update(ref(db), updates);
}

async function confirmRole() {
  const me = myPlayer();
  if (!me) throw new Error("Jogador não encontrado na sala.");

  await update(ref(db, `rooms/${state.roomCode}/players/${state.uid}`), {
    confirmed: true,
    lastSeenAt: serverTimestamp()
  });
}

async function goToVoting() {
  if (!isHost()) throw new Error("Somente o anfitrião pode iniciar votação.");

  const players = getPlayers();
  const updates = {};
  players.forEach((p) => {
    updates[`rooms/${state.roomCode}/players/${p.id}/vote`] = "";
  });

  updates[`rooms/${state.roomCode}/status`] = "voting";
  await update(ref(db), updates);
}

async function vote(targetId) {
  if (!targetId || targetId === state.uid) {
    throw new Error("Voto inválido.");
  }

  await update(ref(db, `rooms/${state.roomCode}/players/${state.uid}`), {
    vote: targetId,
    lastSeenAt: serverTimestamp()
  });
}

async function revealImpostor() {
  if (!isHost()) throw new Error("Somente o anfitrião pode revelar.");
  await update(ref(db, `rooms/${state.roomCode}`), { status: "reveal" });
}

async function playAgain() {
  if (!isHost()) throw new Error("Somente o anfitrião pode reiniciar.");

  const players = getPlayers();
  const updates = {};
  players.forEach((p) => {
    updates[`rooms/${state.roomCode}/players/${p.id}/confirmed`] = false;
    updates[`rooms/${state.roomCode}/players/${p.id}/vote`] = "";
  });

  updates[`rooms/${state.roomCode}/status`] = "lobby";
  updates[`rooms/${state.roomCode}/word`] = "";
  updates[`rooms/${state.roomCode}/impostorId`] = "";
  updates[`rooms/${state.roomCode}/impostorIds`] = [];
  updates[`rooms/${state.roomCode}/speakingOrder`] = [];
  updates[`rooms/${state.roomCode}/countdownEndsAt`] = 0;

  await update(ref(db), updates);
}

async function endRoom() {
  if (!isHost()) throw new Error("Somente o anfitrião pode encerrar.");
  await remove(ref(db, `rooms/${state.roomCode}`));
  await leaveLocalRoom();
}

async function leaveRoom() {
  if (!state.roomCode || !state.uid) return;

  const players = getPlayers();
  const remaining = players.filter((p) => p.id !== state.uid);

  if (isHost()) {
    if (remaining.length === 0) {
      await remove(ref(db, `rooms/${state.roomCode}`));
      await leaveLocalRoom();
      return;
    }

    const nextHost = remaining.slice().sort((a, b) => a.joinedAt - b.joinedAt)[0];
    const updates = {};
    updates[`rooms/${state.roomCode}/hostId`] = nextHost.id;
    updates[`rooms/${state.roomCode}/players/${nextHost.id}/isHost`] = true;
    updates[`rooms/${state.roomCode}/players/${state.uid}`] = null;
    await update(ref(db), updates);
  } else {
    await remove(ref(db, `rooms/${state.roomCode}/players/${state.uid}`));
  }

  await leaveLocalRoom();
}
function renderVoting(phaseFx = false) {
  const players = getPlayers();
  const mine = myPlayer();
  const myVote = mine?.vote || "";
  const votedCount = players.filter((p) => !!p.vote).length;
  const progress = players.length ? Math.round((votedCount / players.length) * 100) : 0;

  return `
    <section class="screen${phaseFx ? " phase-enter" : ""}" data-phase="voting">
      <div class="screen-inner">
        <div class="text-center"><h2>Votação</h2><p>Quem você acha que é o impostor?</p></div>

        <div class="card card-sm">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:0.85rem;">
            <span class="text-muted">Votaram</span>
            <span style="color:var(--primary);font-weight:700;">${votedCount} / ${players.length}</span>
          </div>
          <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${progress}%;"></div></div>
        </div>

        <div class="card">
          <div class="section-title" style="margin-bottom:12px;">Selecione o suspeito</div>
          <div class="vote-list">
            ${players.map((p) => {
              const isSelf = p.id === state.uid;
              const isVoted = myVote === p.id;
              const isLocked = !!myVote && !isVoted;
              return `
                <div class="vote-item ${isSelf ? "self" : ""} ${isVoted ? "selected" : ""} ${isLocked ? "locked" : ""}" data-action="vote" data-target="${escapeHtml(p.id)}">
                  <div class="player-avatar" style="width:34px;height:34px;font-size:0.9rem;background:${escapeHtml(getPlayerColor(p))};">${escapeHtml(getPlayerAvatar(p))}</div>
                  <span style="flex:1;font-weight:600;">${escapeHtml(p.nickname || "Sem nome")}${isSelf ? " (você)" : ""}</span>
                  ${p.vote ? '<span style="font-size:0.7rem;color:var(--common);font-weight:700;">Votou</span>' : ""}
                  <div class="vote-check">${isVoted ? "✓" : ""}</div>
                </div>
              `;
            }).join("")}
          </div>
          ${myVote ? '<p style="margin-top:10px;font-size:0.8rem;color:var(--common);font-weight:700;">Voto confirmado. Aguarde os demais jogadores.</p>' : ""}
        </div>
        ${state.error ? `<div class="error-msg">${escapeHtml(state.error)}</div>` : ""}
      </div>
    </section>
  `;
}

function renderResults(revealed, phaseFx = false) {
  const players = getPlayers();
  const impostorIds = getImpostorIds();
  const votes = {};
  players.forEach((p) => { votes[p.id] = 0; });
  players.forEach((p) => {
    if (p.vote) votes[p.vote] = (votes[p.vote] || 0) + 1;
  });

  const maxVotes = Math.max(...Object.values(votes), 0);
  const mostVoted = players.filter((p) => votes[p.id] === maxVotes && maxVotes > 0);
  const isTie = mostVoted.length > 1;
  const impostors = players.filter((p) => impostorIds.includes(p.id));
  const correctVoters = players.filter((p) => p.vote && impostorIds.includes(p.vote));
  const impostorWasHit = !isTie && mostVoted.length === 1 && impostorIds.includes(mostVoted[0].id);
  const nickOf = (id) => players.find((p) => p.id === id)?.nickname || "Jogador desconectado";

  return `
    <section class="screen${phaseFx ? " phase-enter" : ""}${revealed && phaseFx ? " reveal-enter" : ""}" data-phase="${revealed ? "reveal" : "results"}">
      <div class="screen-inner">
        <div class="text-center"><h2>Resultado da Votação</h2></div>

        <div class="card">
          <div class="section-title" style="margin-bottom:12px;">Votos recebidos</div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${players.slice().sort((a, b) => (votes[b.id] || 0) - (votes[a.id] || 0)).map((p) => {
              const count = votes[p.id] || 0;
              const pct = maxVotes > 0 ? (count / maxVotes) * 100 : 0;
              return `
                <div class="vote-result-item">
                  <div class="player-avatar" style="width:32px;height:32px;font-size:0.85rem;background:${escapeHtml(getPlayerColor(p))};">${escapeHtml(getPlayerAvatar(p))}</div>
                  <span style="font-weight:600;min-width:80px;">${escapeHtml(p.nickname || "Sem nome")}</span>
                  <div class="vote-bar-wrap"><div class="vote-bar-fill" style="width:${pct}%;"></div></div>
                  <span style="font-weight:700;color:var(--primary)">${count}</span>
                </div>
              `;
            }).join("")}
          </div>

          <div class="divider"></div>
          <div class="section-title" style="margin-bottom:8px;">Quem votou em quem</div>
          ${players.map((p) => p.vote ? `<div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:4px;"><strong style="color:var(--text)">${escapeHtml(p.nickname || "Sem nome")}</strong> votou em <strong style="color:var(--primary)">${escapeHtml(nickOf(p.vote))}</strong></div>` : "").join("")}

          ${isTie ? '<div style="margin-top:12px;padding:10px 14px;border-radius:8px;background:rgba(255,200,0,0.1);border:1px solid rgba(255,200,0,0.3);font-size:0.85rem;color:#FFD700;">Empate! Os impostores sobrevivem.</div>' : ""}
          ${!isTie && !impostorWasHit ? '<div style="margin-top:12px;padding:10px 14px;border-radius:8px;background:rgba(255,77,77,0.12);border:1px solid rgba(255,77,77,0.32);font-size:0.85rem;color:#ff8f8f;">Ninguém votou em um impostor. Os impostores sobreviveram.</div>' : ""}
        </div>

        ${!revealed ? `
          ${isHost() ? '<button class="btn btn-danger" data-action="reveal-impostor">Revelar o Impostor</button>' : '<div class="card card-sm text-center"><p>Aguardando o anfitrião revelar o impostor<span class="waiting-dots"></span></p></div>'}
        ` : `
          <div>
            <div class="card impostor-reveal">
              <p style="font-size:0.85rem;color:var(--text-muted)">${impostors.length > 1 ? "Os impostores eram..." : "O impostor era..."}</p>
              <div class="impostor-name">${impostors.length > 0 ? impostors.map((p) => escapeHtml(p.nickname || "Desconhecido")).join(", ") : "Desconhecido"}</div>
              <div class="divider"></div>
              <p style="font-size:0.85rem;color:var(--text-muted)">A palavra secreta era:</p>
              <div style="font-size:clamp(1.5rem,6vw,2rem);font-weight:900;color:var(--common);text-transform:uppercase;">${escapeHtml(state.roomData.word || "")}</div>
            </div>

            ${correctVoters.length > 0 ? `<div class="card card-sm" style="margin-top:12px;"><p style="font-weight:700;color:var(--common);margin-bottom:6px;">Acertaram um impostor:</p>${correctVoters.map((p) => `<div>✓ ${escapeHtml(p.nickname || "Sem nome")}${p.id === state.uid ? " (você)" : ""}</div>`).join("")}</div>` : ""}

            <div style="display:flex;flex-direction:column;gap:12px;margin-top:16px;">
              ${isHost() ? `
                <button class="btn btn-success" data-action="play-again">Jogar Novamente</button>
                <button class="btn btn-ghost" data-action="end-room">Encerrar Sala</button>
              ` : '<div class="card card-sm text-center"><p>Aguardando o anfitrião para jogar novamente<span class="waiting-dots"></span></p></div>'}
            </div>
          </div>
        `}

        ${state.error ? `<div class="error-msg">${escapeHtml(state.error)}</div>` : ""}
      </div>
    </section>
  `;
}

function render() {
  const nextPhase = !state.uid
    ? "loading"
    : (!state.roomCode || !state.roomData)
      ? "home"
      : (state.roomData.status || "lobby");
  const phaseFx = state.lastPhase !== nextPhase;
  state.lastPhase = nextPhase;

  if (!state.uid) {
    appEl.innerHTML = `
      <section class="screen${phaseFx ? " phase-enter" : ""}" data-phase="loading">
        <div class="screen-inner">
          <div class="card text-center">
            <p>${state.error ? "Erro ao conectar" : "Conectando..."}</p>
            ${state.error ? `<div class="error-msg" style="margin-top:12px;">${escapeHtml(state.error)}</div>` : ""}
            <button class="btn btn-ghost" data-action="retry-auth" style="margin-top:12px;">Tentar novamente</button>
          </div>
        </div>
      </section>
    `;
    document.querySelector("[data-action='retry-auth']")?.addEventListener("click", async () => {
      state.error = "";
      render();
      await authenticateAnonymously();
    });
    return;
  }

  if (!state.roomCode || !state.roomData) {
    appEl.innerHTML = renderHome(phaseFx);
    bindHomeActions();
    return;
  }

  const status = state.roomData.status;
  if (status === "lobby") appEl.innerHTML = renderLobby(phaseFx);
  if (status === "countdown") appEl.innerHTML = renderCountdown(phaseFx);
  if (status === "revealing") appEl.innerHTML = renderRevealing(phaseFx);
  if (status === "playing") appEl.innerHTML = renderPlaying(phaseFx);
  if (status === "voting") appEl.innerHTML = renderVoting(phaseFx);
  if (status === "results") appEl.innerHTML = renderResults(false, phaseFx);
  if (status === "reveal") appEl.innerHTML = renderResults(true, phaseFx);

  bindGameActions();
}
function renderHome(phaseFx = false) {
  const loading = state.loading ? "disabled" : "";
  const nicknameValid = state.nickname.trim().length >= 2 && state.nickname.trim().length <= 16;
  const currentTab = HUB_TABS.some((tab) => tab.id === state.homeTab) ? state.homeTab : "home";
  const navButton = (tab, navType) => `
    <button class="hub-nav-btn ${currentTab === tab.id ? "active" : ""}" data-action="hub-tab" data-tab="${tab.id}" data-nav="${navType}">
      <span class="hub-nav-icon">${tab.icon}</span>
      <span class="hub-nav-label">${tab.label}</span>
    </button>
  `;

  let content = "";
  if (currentTab === "home") {
    content = `
      <div class="card">
        <div class="hub-title-row">
          <div>
            <h3>Continuar jogando</h3>
            <p>Retome sua próxima rodada em segundos.</p>
          </div>
          <span class="hub-chip">Rápido</span>
        </div>
        <div class="hub-game-hero">
          <div class="hub-game-emoji">🎭</div>
          <div>
            <div class="hub-game-name">O Impostor</div>
            <div class="hub-game-meta">3-8 jogadores • 10 min</div>
          </div>
        </div>
        <div class="hub-actions">
          <button class="btn btn-primary" data-action="hub-go-rooms">Criar ou entrar em sala</button>
          <button class="btn btn-ghost" data-action="hub-go-games">Explorar outros jogos</button>
        </div>
      </div>

      <div class="card">
        <div class="hub-title-row">
          <h3>Jogos em destaque</h3>
          <span class="hub-chip muted">Atualizado</span>
        </div>
        <div class="hub-grid two">
          <button class="hub-game-card active" data-action="hub-go-rooms">
            <span class="badge-live">AO VIVO</span>
            <div class="hub-game-emoji">🎭</div>
            <div class="hub-game-name">O Impostor</div>
            <div class="hub-game-meta">Partidas sociais</div>
          </button>
          <div class="hub-game-card locked">
            <span class="badge-soft">Em breve</span>
            <div class="hub-game-emoji">🕵️</div>
            <div class="hub-game-name">Detetive</div>
            <div class="hub-game-meta">Inferência</div>
          </div>
        </div>
      </div>
    `;
  }

  if (currentTab === "games") {
    content = `
      <div class="card">
        <div class="hub-title-row">
          <h3>Catálogo de jogos</h3>
          <span class="hub-chip">Mobile first</span>
        </div>
        <div class="hub-grid two">
          <button class="hub-game-card active" data-action="hub-go-rooms">
            <span class="badge-live">JOGAR</span>
            <div class="hub-game-emoji">🎭</div>
            <div class="hub-game-name">O Impostor</div>
            <div class="hub-game-meta">Blefe e dedução</div>
          </button>
          <div class="hub-game-card locked"><span class="badge-soft">Em breve</span><div class="hub-game-emoji">🧠</div><div class="hub-game-name">Código Secreto</div><div class="hub-game-meta">Estratégia</div></div>
          <div class="hub-game-card locked"><span class="badge-soft">Em breve</span><div class="hub-game-emoji">⚡</div><div class="hub-game-name">Duelo Rápido</div><div class="hub-game-meta">1v1</div></div>
          <div class="hub-game-card locked"><span class="badge-soft">Em breve</span><div class="hub-game-emoji">🎲</div><div class="hub-game-name">Party Mix</div><div class="hub-game-meta">Casual</div></div>
        </div>
      </div>
    `;
  }

  if (currentTab === "rooms") {
    content = `
      <div class="card">
        <div class="input-group">
          <label for="nickname">Seu apelido</label>
          <input id="nickname" type="text" maxlength="16" placeholder="Como quer ser chamado?" value="${escapeHtml(state.nickname)}" />
        </div>
      </div>

      <div class="card">
        <h3 style="margin-bottom:10px;">Criar sala</h3>
        <p style="margin-bottom:14px;">Comece uma rodada e compartilhe o código com seus amigos.</p>
        <button class="btn btn-primary" data-action="create-room" data-requires-nick="1" ${loading} ${nicknameValid ? "" : "disabled"}>${state.loading ? "Criando..." : "Criar Sala Agora"}</button>
      </div>

      <div class="card">
        <h3 style="margin-bottom:10px;">Entrar com código</h3>
        <div class="input-group" style="margin-bottom:12px;">
          <label for="join-code">Código da sala</label>
          <input id="join-code" type="text" maxlength="4" placeholder="Ex: K7BX" style="text-transform:uppercase;letter-spacing:0.2em;text-align:center;" />
        </div>
        <button class="btn btn-ghost" data-action="join-room" data-requires-nick="1" ${loading} ${nicknameValid ? "" : "disabled"}>${state.loading ? "Entrando..." : "Entrar na Sala"}</button>
      </div>
    `;
  }

  if (currentTab === "friends") {
    const friendEntries = Object.entries(state.friends || {});
    const incomingEntries = Object.entries(state.incomingRequests || {});
    const myId = state.uid || "";
    content = `
      <div class="card">
        <div class="hub-title-row">
          <h3>Adicionar amigo</h3>
          <span class="hub-chip">${friendEntries.length} amigos</span>
        </div>
        <div class="input-group">
          <label for="friend-code">ID do amigo</label>
          <input id="friend-code" type="text" maxlength="64" placeholder="Cole o ID do amigo" value="${escapeHtml(state.friendCodeInput || "")}" />
        </div>
        <div class="hub-actions" style="margin-top:12px;">
          <button class="btn btn-primary" data-action="send-friend-request">Enviar pedido</button>
          <button class="btn btn-ghost" data-action="copy-my-id">Copiar meu ID</button>
        </div>
        <p style="margin-top:10px;font-size:0.78rem;">Seu ID: <strong style="color:var(--text)">${escapeHtml(myId || "conectando...")}</strong></p>
      </div>

      <div class="card">
        <div class="hub-title-row">
          <h3>Pedidos recebidos</h3>
          <span class="hub-chip muted">${incomingEntries.length}</span>
        </div>
        ${incomingEntries.length === 0 ? '<p>Nenhum pedido pendente.</p>' : `
          <div class="hub-list">
            ${incomingEntries.map(([fromUid, request]) => `
              <div class="hub-list-item" style="justify-content:space-between;align-items:flex-start;">
                <div>
                  <div style="font-weight:700;">${escapeHtml(request?.fromNickname || state.profiles?.[fromUid]?.nickname || "Jogador")}</div>
                  <div style="font-size:0.74rem;color:var(--text-muted);margin-top:2px;">ID: ${escapeHtml(fromUid)}</div>
                </div>
                <div style="display:flex;gap:8px;">
                  <button class="btn btn-success" style="width:auto;padding:9px 12px;" data-action="accept-friend" data-uid="${escapeHtml(fromUid)}">Aceitar</button>
                  <button class="btn btn-ghost" style="width:auto;padding:9px 12px;" data-action="reject-friend" data-uid="${escapeHtml(fromUid)}">Recusar</button>
                </div>
              </div>
            `).join("")}
          </div>
        `}
      </div>

      <div class="card">
        <div class="hub-title-row">
          <h3>Minha lista</h3>
          <span class="hub-chip muted">${friendEntries.length}</span>
        </div>
        ${friendEntries.length === 0 ? '<p>Você ainda não adicionou amigos.</p>' : `
          <div class="hub-list">
            ${friendEntries.map(([friendUid, friendData]) => {
              const profileNick = state.profiles?.[friendUid]?.nickname;
              const nickname = profileNick || friendData?.nickname || "Jogador";
              const presence = state.presence?.[friendUid] || {};
              const lastSeen = Number(presence.lastSeenAt) || 0;
              const recentlyActive = lastSeen > 0 && (Date.now() - lastSeen) < 45000;
              const online = !!presence.online || recentlyActive;
              const roomCode = presence.roomCode || "";
              return `
                <div class="hub-list-item" style="justify-content:space-between;">
                  <div>
                    <div style="font-weight:700;">${escapeHtml(nickname)}</div>
                    <div style="font-size:0.74rem;color:var(--text-muted);margin-top:2px;">${online ? `Online${roomCode ? ` • Sala ${escapeHtml(roomCode)}` : ""}` : "Offline"}</div>
                  </div>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span>${online ? "🟢" : "⚪"}</span>
                    <button class="btn btn-ghost" style="width:auto;padding:7px 10px;" data-action="remove-friend" data-uid="${escapeHtml(friendUid)}">Excluir</button>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        `}
      </div>
    `;
  }

  if (currentTab === "profile") {
    const games = Number(state.userStats?.games) || 0;
    const wins = Number(state.userStats?.wins) || 0;
    const winRate = games > 0 ? (wins / games) : 0;
    const rating = (winRate * 5).toFixed(1);
    content = `
      <div class="card">
        <div class="hub-title-row">
          <h3>Perfil</h3>
          <span class="hub-chip">Local</span>
        </div>
        <div class="input-group">
          <label for="nickname">Apelido padrão</label>
          <input id="nickname" type="text" maxlength="16" placeholder="Como quer ser chamado?" value="${escapeHtml(state.nickname)}" />
        </div>
        <p style="margin-top:10px;">Seu avatar e cor continuam sendo definidos no lobby de cada sala.</p>
      </div>
      <div class="card card-sm">
        <div class="hub-metrics">
          <div><strong>${games}</strong><span>Partidas</span></div>
          <div><strong>${wins}</strong><span>Vitórias</span></div>
          <div><strong>${rating}</strong><span>Nota</span></div>
        </div>
      </div>
    `;
  }

  return `
    <section class="screen${phaseFx ? " phase-enter" : ""}" data-phase="home">
      <div class="hub-shell">
        <aside class="hub-sidebar">
          <div class="hub-brand">
            <span class="logo-icon">🎭</span>
            <div>
              <div class="hub-brand-title">Party Hub</div>
              <div class="hub-brand-subtitle">Vários jogos</div>
            </div>
          </div>
          <div class="hub-sidebar-nav">
            ${HUB_TABS.map((tab) => navButton(tab, "side")).join("")}
          </div>
        </aside>

        <div class="hub-main">
          <header class="hub-header">
            <div>
              <h2>Game Hub</h2>
              <p>Escolha seu jogo e entre na ação.</p>
            </div>
            <span class="hub-user-pill">${escapeHtml(state.nickname || "Jogador")}</span>
          </header>

          <div class="hub-content">
            ${content}
            ${state.error ? `<div class="error-msg">${escapeHtml(state.error)}</div>` : ""}
          </div>

          <nav class="hub-bottom-nav">
            ${HUB_TABS.map((tab) => navButton(tab, "bottom")).join("")}
          </nav>
        </div>
      </div>
    </section>
  `;
}

function renderLobby(phaseFx = false) {
  const players = getPlayers();
  const mine = myPlayer();
  const canStart = isHost() && players.length >= 3;
  const settings = getRoomSettings();
  const maxImpostors = getMaxImpostorCount(players.length);
  const myAvatar = mine?.avatar || state.avatar;
  const myCardColor = mine?.cardColor || state.cardColor;

  return `
    <section class="screen${phaseFx ? " phase-enter" : ""}" data-phase="lobby">
      <div class="screen-inner">
        <div class="room-code-display ${state.copyFeedback ? "copied" : ""}" style="cursor:pointer" data-action="copy-code">
          <div class="label">Código da Sala</div>
          <div class="code">${escapeHtml(state.roomCode)}</div>
          ${state.copyFeedback ? '<div class="copy-feedback">Código copiado</div>' : ""}
        </div>

        <div class="card">
          <div class="section-title" style="margin-bottom:12px;">Jogadores (${players.length}/8)</div>
          <div class="player-list">
            ${players.map((p) => `
              <div class="player-item ${p.id === state.uid ? "me" : ""}" style="background:${hexToRgba(getPlayerColor(p), 0.14)};border-color:${hexToRgba(getPlayerColor(p), 0.45)};">
                <div class="player-avatar" style="background:${escapeHtml(getPlayerColor(p))};">${escapeHtml(getPlayerAvatar(p))}</div>
                <span class="player-name">${escapeHtml(p.nickname || "Sem nome")}</span>
                <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                  ${p.id === state.roomData.hostId ? '<span class="player-badge badge-host">Anfitriao</span>' : ""}
                  ${p.id === state.uid ? '<span class="player-badge badge-you">Você</span>' : ""}
                </div>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="card">
          <div class="section-title" style="margin-bottom:12px;">Personalizar no lobby</div>
          <div class="profile-preview" style="background:${hexToRgba(myCardColor, 0.2)};border:1px solid ${myCardColor};">
            <div class="player-avatar profile-avatar" style="background:${escapeHtml(myCardColor)};">${escapeHtml(myAvatar)}</div>
            <div>
              <div class="profile-name">${escapeHtml(mine?.nickname || "Sem nome")}</div>
              <div class="profile-meta">Avatar e cor ficam bloqueados para os demais</div>
            </div>
          </div>

          <div class="profile-section">
            <div class="profile-title">Avatar</div>
            <div class="avatar-picker">
              ${AVATAR_OPTIONS.map((avatar) => {
                const takenByOther = players.some((p) => p.id !== state.uid && p.avatar === avatar);
                return `
                  <button
                    class="avatar-option ${myAvatar === avatar ? "selected" : ""}"
                    data-action="lobby-pick-avatar"
                    data-avatar="${escapeHtml(avatar)}"
                    ${takenByOther ? "disabled" : ""}
                    title="${takenByOther ? "Indisponível" : "Selecionar avatar"}"
                  >${escapeHtml(avatar)}</button>
                `;
              }).join("")}
            </div>
          </div>

          <div class="profile-section">
            <div class="profile-title">Cor do card</div>
            <div class="color-picker">
              ${CARD_COLOR_OPTIONS.map((color) => {
                const takenByOther = players.some((p) => p.id !== state.uid && p.cardColor === color);
                return `
                  <button
                    class="color-option ${myCardColor === color ? "selected" : ""}"
                    data-action="lobby-pick-color"
                    data-color="${color}"
                    style="background:${color};"
                    ${takenByOther ? "disabled" : ""}
                    title="${takenByOther ? "Indisponível" : "Selecionar cor"}"
                  ></button>
                `;
              }).join("")}
            </div>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:12px;">
          ${isHost() ? `
            <button class="btn btn-primary" data-action="start-game" ${canStart ? "" : "disabled"}>
              ${canStart ? `Iniciar Partida (${players.length} jogadores)` : `Aguardando jogadores (${players.length}/3 mínimo)`}
            </button>
            <button class="btn btn-ghost" data-action="toggle-room-settings">Configuração da Partida</button>
            ${state.showRoomSettings ? `
              <div class="card card-sm">
                <div class="section-title" style="margin-bottom:10px;">Configuração</div>
                <div style="display:flex;flex-direction:column;gap:12px;">
                  <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                    <span style="font-size:0.9rem;color:var(--text);">Dica nível 3 do impostor</span>
                    <input type="checkbox" data-action="settings-level3-toggle" ${settings.level3HintEnabled ? "checked" : ""} />
                  </label>
                  <label style="display:flex;flex-direction:column;gap:6px;">
                    <span style="font-size:0.9rem;color:var(--text);">Quantidade de impostores</span>
                    <select data-action="settings-impostor-count" style="width:100%;background:rgba(255,255,255,0.04);border:1.5px solid rgba(255,255,255,0.12);border-radius:12px;padding:10px 12px;color:var(--text);">
                      ${Array.from({ length: maxImpostors }, (_, idx) => idx + 1).map((count) => `<option value="${count}" ${settings.impostorCount === count ? "selected" : ""}>${count}</option>`).join("")}
                    </select>
                    <span style="font-size:0.75rem;color:var(--text-muted);">Máximo atual: ${maxImpostors} (com ${players.length} jogadores).</span>
                  </label>
                </div>
              </div>
            ` : ""}
            <button class="btn btn-ghost" data-action="leave-room">Encerrar Sala</button>
          ` : `
            <div class="card card-sm text-center"><p>Aguardando o anfitrião iniciar<span class="waiting-dots"></span></p></div>
            <button class="btn btn-ghost" data-action="leave-room">Sair da Sala</button>
          `}
        </div>
        ${state.error ? `<div class="error-msg">${escapeHtml(state.error)}</div>` : ""}
      </div>
    </section>
  `;
}

function renderCountdown(phaseFx = false) {
  const count = state.countdownLeft;
  return `
    <section class="screen${phaseFx ? " phase-enter" : ""}" data-phase="countdown">
      <div style="text-align:center;position:relative;z-index:1;">
        <p style="font-size:1rem;color:var(--text-muted);margin-bottom:16px;">Prepare-se!</p>
        <div class="countdown-number">${count > 0 ? count : "Vai!"}</div>
        <p style="margin-top:24px;color:var(--text-muted);font-size:0.9rem;">Cada jogador vai ver o seu papel em seguida.</p>
      </div>
    </section>
  `;
}

function renderRevealing(phaseFx = false) {
  const me = myPlayer();
  const players = getPlayers();
  const { level3HintEnabled } = getRoomSettings();
  const impostorIds = getImpostorIds();
  const confirmedCount = players.filter((p) => p.confirmed).length;
  const isImpostor = impostorIds.includes(state.uid);
  const impostorStarts = isImpostor && state.roomData?.speakingOrder?.[0] === state.uid;
  const level3Hint = impostorStarts && level3HintEnabled ? getLevel3Hint(state.roomData.word, state.roomCode) : "";

  return `
    <section class="screen${phaseFx ? " phase-enter" : ""}" data-phase="revealing">
      <div class="screen-inner">
        <div style="text-align:center;"><h2>Seu papel nesta rodada</h2><p>Apenas você pode ver esta tela</p></div>
        <div class="card role-card ${isImpostor ? "impostor" : "common"}">
          ${isImpostor ? `
            <span class="role-emoji">🔴</span>
            <h2 style="color:var(--impostor)">${impostorIds.length > 1 ? "Você é um dos IMPOSTORES!" : "Você é o IMPOSTOR!"}</h2>
            <p>Você não recebeu a palavra secreta.</p>
            <div class="role-word secret">???</div>
            ${impostorStarts && level3HintEnabled ? `
              <div class="card card-sm" style="margin-top:12px;background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.15);">
                <p style="font-size:0.78rem;letter-spacing:0.08em;text-transform:uppercase;">Dica nível 3 (você começa)</p>
                <div style="font-size:1.2rem;font-weight:800;color:#fff;margin-top:4px;text-transform:uppercase;">
                  ${escapeHtml(level3Hint)}
                </div>
                <p style="font-size:0.78rem;margin-top:6px;">Use como pista ampla. Não entregue algo muito específico.</p>
              </div>
            ` : ""}
          ` : `
            <span class="role-emoji">🔵</span>
            <h2 style="color:var(--common)">Você é um Jogador Comum</h2>
            <p>A palavra secreta desta rodada é:</p>
            <div class="role-word">${escapeHtml((state.roomData.word || "").toUpperCase())}</div>
          `}
        </div>

        ${me?.confirmed ? `
          <div class="text-center"><p>Você confirmou. Aguardando os outros<span class="waiting-dots"></span></p></div>
        ` : '<button class="btn btn-primary" data-action="confirm-role">Entendi</button>'}

        <div>
          <div style="margin-bottom:8px;" class="text-center text-muted">${confirmedCount} de ${players.length} jogadores confirmaram</div>
          <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${players.length ? (confirmedCount / players.length) * 100 : 0}%;"></div></div>
        </div>
        ${state.error ? `<div class="error-msg">${escapeHtml(state.error)}</div>` : ""}
      </div>
    </section>
  `;
}

function renderPlaying(phaseFx = false) {
  const players = getPlayers();
  const order = state.roomData.speakingOrder || [];
  const nickOf = (id) => players.find((p) => p.id === id)?.nickname || "Jogador desconectado";
  const playerOf = (id) => getPlayerById(id);
  const firstId = order[0];

  return `
    <section class="screen${phaseFx ? " phase-enter" : ""}" data-phase="playing">
      <div class="screen-inner">
        <div class="card text-center">
          <h2>Fase de Dicas</h2>
          <p>Cada jogador fala uma palavra relacionada. O impostor tentara blefar.</p>
        </div>

        <div class="highlight-box">
          <div class="section-title" style="margin-bottom:6px;">Comeca agora</div>
          <div class="big-text">${firstId === state.uid ? "Você!" : escapeHtml(nickOf(firstId))}</div>
        </div>

        <div class="card">
          <div class="section-title" style="margin-bottom:12px;">Ordem de fala</div>
          <div class="speaking-order">
            ${order.map((id, idx) => `
              <div class="speaking-item ${idx === 0 ? "first" : ""}">
                <div class="player-avatar" style="width:32px;height:32px;font-size:0.85rem;background:${escapeHtml(getPlayerColor(playerOf(id)))};">${escapeHtml(getPlayerAvatar(playerOf(id)))}</div>
                <span style="font-weight:${id === state.uid ? 700 : 500};flex:1;">${escapeHtml(nickOf(id))}${id === state.uid ? " (você)" : ""}</span>
              </div>
            `).join("")}
          </div>
        </div>

        ${isHost() ? `
          <button class="btn btn-danger" data-action="go-voting">Ir para Votação</button>
        ` : `
          <div class="card card-sm text-center"><p>Aguardando o anfitrião iniciar a votação.</p></div>
        `}
        ${state.error ? `<div class="error-msg">${escapeHtml(state.error)}</div>` : ""}
      </div>
    </section>
  `;
}
function bindHomeActions() {
  const nicknameInput = document.getElementById("nickname");
  const joinInput = document.getElementById("join-code");
  const friendCodeInput = document.getElementById("friend-code");
  if (nicknameInput && (state.homeTab === "rooms" || state.homeTab === "profile")) nicknameInput.focus();

  nicknameInput?.addEventListener("input", () => {
    state.nickname = nicknameInput.value.slice(0, 16);
    saveNicknameLocally(state.nickname);
    if (state.uid) {
      upsertUserProfile().then(() => propagateNicknameToFriends()).catch(() => {
        // no-op
      });
    }
    const isValid = state.nickname.trim().length >= 2 && state.nickname.trim().length <= 16;
    document.querySelectorAll("[data-requires-nick='1']").forEach((btn) => {
      btn.disabled = !isValid;
    });
  });

  if (joinInput) {
    joinInput.addEventListener("input", () => {
      joinInput.value = joinInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    });
  }

  friendCodeInput?.addEventListener("input", () => {
    state.friendCodeInput = friendCodeInput.value.trim().slice(0, 64);
  });

  document.querySelectorAll("[data-action='hub-tab']").forEach((el) => {
    el.addEventListener("click", () => {
      const tab = el.getAttribute("data-tab");
      if (!tab) return;
      state.homeTab = tab;
      clearError();
      render();
    });
  });

  document.querySelector("[data-action='hub-go-rooms']")?.addEventListener("click", () => {
    state.homeTab = "rooms";
    clearError();
    render();
  });

  document.querySelector("[data-action='hub-go-games']")?.addEventListener("click", () => {
    state.homeTab = "games";
    clearError();
    render();
  });

  document.querySelector("[data-action='copy-my-id']")?.addEventListener("click", async () => {
    if (!state.uid) return;
    try {
      await navigator.clipboard.writeText(state.uid);
    } catch {
      // no-op
    }
  });

  document.querySelector("[data-action='send-friend-request']")?.addEventListener("click", async () => {
    try {
      await sendFriendRequest((document.getElementById("friend-code")?.value || state.friendCodeInput || "").trim());
      state.friendCodeInput = "";
      clearError();
      render();
    } catch (error) {
      setError(error.message || "Não foi possível enviar pedido.");
    }
  });

  document.querySelectorAll("[data-action='accept-friend']").forEach((el) => {
    el.addEventListener("click", async () => {
      const friendUid = el.getAttribute("data-uid");
      if (!friendUid) return;
      try {
        await acceptFriendRequest(friendUid);
        clearError();
      } catch (error) {
        setError(error.message || "Não foi possível aceitar pedido.");
      }
    });
  });

  document.querySelectorAll("[data-action='reject-friend']").forEach((el) => {
    el.addEventListener("click", async () => {
      const friendUid = el.getAttribute("data-uid");
      if (!friendUid) return;
      try {
        await rejectFriendRequest(friendUid);
        clearError();
      } catch (error) {
        setError(error.message || "Não foi possível recusar pedido.");
      }
    });
  });

  document.querySelectorAll("[data-action='remove-friend']").forEach((el) => {
    el.addEventListener("click", async () => {
      const friendUid = el.getAttribute("data-uid");
      if (!friendUid) return;
      try {
        await removeFriend(friendUid);
        clearError();
      } catch (error) {
        setError(error.message || "Não foi possível excluir amigo.");
      }
    });
  });

  document.querySelector("[data-action='create-room']")?.addEventListener("click", async () => {
    const nickname = state.nickname.trim();
    if (nickname.length < 2 || nickname.length > 16) {
      setError("Use um apelido entre 2 e 16 caracteres.");
      return;
    }
    state.nickname = nickname;
    saveNicknameLocally(state.nickname);
    await upsertUserProfile().then(() => propagateNicknameToFriends()).catch(() => {
      // no-op
    });

    state.loading = true;
    render();

    try {
      await createRoom(nickname);
      state.error = "";
    } catch (error) {
      setError(error.message || "Erro ao criar sala.");
    } finally {
      state.loading = false;
      render();
    }
  });

  document.querySelector("[data-action='join-room']")?.addEventListener("click", async () => {
    const nickname = state.nickname.trim();
    const code = (document.getElementById("join-code")?.value || "").trim().toUpperCase();

    if (nickname.length < 2 || nickname.length > 16) {
      setError("Use um apelido entre 2 e 16 caracteres.");
      return;
    }

    if (code.length !== 4) {
      setError("Informe um código de 4 caracteres.");
      return;
    }
    state.nickname = nickname;
    saveNicknameLocally(state.nickname);
    await upsertUserProfile().then(() => propagateNicknameToFriends()).catch(() => {
      // no-op
    });

    state.loading = true;
    render();

    try {
      await joinRoom(nickname, code);
      state.error = "";
    } catch (error) {
      setError(error.message || "Erro ao entrar na sala.");
    } finally {
      state.loading = false;
      render();
    }
  });
}

function bindGameActions() {
  document.querySelector("[data-action='copy-code']")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.roomCode);
      state.copyFeedback = true;
      clearTimeout(state.copyFeedbackTimer);
      state.copyFeedbackTimer = setTimeout(() => {
        state.copyFeedback = false;
        render();
      }, 1400);
      render();
    } catch {
      // no-op
    }
  });

  document.querySelector("[data-action='start-game']")?.addEventListener("click", async () => {
    try {
      await startGame();
      state.error = "";
    } catch (error) {
      setError(error.message || "Não foi possível iniciar.");
    }
  });

  document.querySelector("[data-action='toggle-room-settings']")?.addEventListener("click", () => {
    state.showRoomSettings = !state.showRoomSettings;
    clearError();
    render();
  });

  document.querySelector("[data-action='settings-level3-toggle']")?.addEventListener("change", async (event) => {
    try {
      const checked = !!event.target?.checked;
      await updateRoomSettings({ level3HintEnabled: checked });
      state.error = "";
    } catch (error) {
      setError(error.message || "Não foi possível atualizar configuração.");
    }
  });

  document.querySelector("[data-action='settings-impostor-count']")?.addEventListener("change", async (event) => {
    try {
      const value = Number.parseInt(event.target?.value || "1", 10);
      await updateRoomSettings({ impostorCount: Number.isNaN(value) ? 1 : value });
      state.error = "";
    } catch (error) {
      setError(error.message || "Não foi possível atualizar configuração.");
    }
  });

  document.querySelectorAll("[data-action='lobby-pick-avatar']").forEach((el) => {
    el.addEventListener("click", async () => {
      const avatar = el.getAttribute("data-avatar");
      if (!avatar) return;

      try {
        await updateLobbyProfile({ avatar });
        state.error = "";
      } catch (error) {
        setError(error.message || "Não foi possível atualizar avatar.");
      }
    });
  });

  document.querySelectorAll("[data-action='lobby-pick-color']").forEach((el) => {
    el.addEventListener("click", async () => {
      const cardColor = el.getAttribute("data-color");
      if (!cardColor) return;

      try {
        await updateLobbyProfile({ cardColor });
        state.error = "";
      } catch (error) {
        setError(error.message || "Não foi possível atualizar cor.");
      }
    });
  });

  document.querySelector("[data-action='confirm-role']")?.addEventListener("click", async () => {
    try {
      await confirmRole();
      state.error = "";
    } catch (error) {
      setError(error.message || "Não foi possível confirmar.");
    }
  });

  document.querySelector("[data-action='go-voting']")?.addEventListener("click", async () => {
    try {
      await goToVoting();
      state.error = "";
    } catch (error) {
      setError(error.message || "Não foi possível iniciar votação.");
    }
  });

  document.querySelectorAll("[data-action='vote']").forEach((el) => {
    el.addEventListener("click", async () => {
      const targetId = el.getAttribute("data-target") || "";
      const mine = myPlayer();
      if (mine?.vote || targetId === state.uid) return;

      try {
        await vote(targetId);
        state.error = "";
      } catch (error) {
        setError(error.message || "Não foi possível registrar voto.");
      }
    });
  });

  document.querySelector("[data-action='reveal-impostor']")?.addEventListener("click", async () => {
    try {
      await revealImpostor();
      state.error = "";
    } catch (error) {
      setError(error.message || "Não foi possível revelar.");
    }
  });

  document.querySelector("[data-action='play-again']")?.addEventListener("click", async () => {
    try {
      await playAgain();
      state.error = "";
    } catch (error) {
      setError(error.message || "Não foi possível reiniciar.");
    }
  });

  document.querySelector("[data-action='end-room']")?.addEventListener("click", async () => {
    try {
      await endRoom();
      state.error = "";
    } catch (error) {
      setError(error.message || "Não foi possível encerrar.");
    }
  });

  document.querySelector("[data-action='leave-room']")?.addEventListener("click", async () => {
    try {
      await leaveRoom();
      state.error = "";
    } catch (error) {
      setError(error.message || "Não foi possível sair.");
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    state.uid = null;
    clearSocialSubscriptions();
    clearStatsSubscription();
    stopConnectionPresenceSync();
    await clearPresenceHook();
    render();
    return;
  }

  state.uid = user.uid;
  state.recordedRounds = {};
  subscribeSocialData();
  subscribeMyStats();
  await upsertUserProfile().then(() => propagateNicknameToFriends()).catch(() => {
    // no-op
  });
  await attachUserPresence().catch(() => {
    // no-op
  });
  startConnectionPresenceSync();
  await tryResumeRoomSession();
  render();
});

authenticateAnonymously();

window.addEventListener("beforeunload", () => {
  clearRoomSubscription();
  clearSocialSubscriptions();
  stopConnectionPresenceSync();
  clearPresenceHook();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (!state.uid || !state.roomCode) return;
  attachPresence(state.roomCode).catch(() => {
    // no-op
  });
});

window.addEventListener("pageshow", () => {
  if (!state.uid || !state.roomCode) return;
  attachPresence(state.roomCode).catch(() => {
    // no-op
  });
});

render();

