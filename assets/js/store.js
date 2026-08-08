/* ============================================================
   store.js — all persistence for Beyond Orbit.
   Everything lives in localStorage as JSON: no server, no DB.
   ============================================================ */

const K = {
  users: "bo_users",
  session: "bo_session",
  serverProfile: "bo_server_profile",
  progress: "bo_progress",
  settings: "bo_settings",
};

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
};
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

/* --- tiny non-cryptographic hash: keeps plain passwords out of storage.
   A coursework project has no server, so this is obfuscation, not security. */
export function hashPassword(text) {
  let h1 = 0x9e3779b9;
  let h2 = 0x85ebca6b;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = (h1 ^ (h1 >>> 15)) >>> 0;
  h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  return `${h1.toString(36)}.${h2.toString(36)}`;
}

/* ---------------------------------------------------------- Users */
export const getUsers = () => read(K.users, {});
export const saveUsers = (users) => write(K.users, users);

export function registerUser({ username, email, phone, address, password, avatar }) {
  const users = getUsers();
  const key = username.trim().toUpperCase();
  if (users[key]) throw new Error("That cadet name is already orbiting. Try another.");
  users[key] = {
    username: key,
    email: email.trim(),
    phone: (phone || "").trim(),
    address: (address || "").trim(),
    pass: hashPassword(password),
    avatar: avatar || "🚀",
    joined: new Date().toISOString(),
  };
  saveUsers(users);
  ensureProgress(key);
  return users[key];
}

export function loginUser(username, password) {
  const users = getUsers();
  const user = users[(username || "").trim().toUpperCase()];
  if (!user) throw new Error("No cadet found with that name. Register first.");
  if (user.pass !== hashPassword(password)) throw new Error("Wrong password. The airlock stays shut.");
  localStorage.setItem(K.session, user.username);
  touchStreak(user.username);
  return user;
}

export const logout = () => {
  localStorage.removeItem(K.session);
  localStorage.removeItem(K.serverProfile);
};
/** Server-backed sessions keep the display profile separately from the
    bearer token held by api.js. This lets the shared nav recognise a
    PHP login without ever storing its password locally. */
export const saveServerProfile = (user) => {
  if (user?.username) write(K.serverProfile, user);
  return user;
};
export const clearServerProfile = () => localStorage.removeItem(K.serverProfile);
export const serverProfile = () => read(K.serverProfile, null);

export const currentUsername = () => localStorage.getItem(K.session) || serverProfile()?.username || null;
export function currentUser() {
  const name = currentUsername();
  return name ? getUsers()[name] || serverProfile() || null : null;
}

/* ------------------------------------------------------ Progress */
const EMPTY_PROGRESS = {
  xp: 0,
  levels: {},
  badges: [],
  planets: [],
  quiz: { best: 0, attempts: 0, lastAnswers: [] },
  reflection: "",
  streak: { count: 0, last: null },
  updated: null,
};

export const getAllProgress = () => read(K.progress, {});
export const saveAllProgress = (all) => write(K.progress, all);

export function ensureProgress(username) {
  const all = getAllProgress();
  if (!all[username]) {
    all[username] = structuredClone(EMPTY_PROGRESS);
    saveAllProgress(all);
  }
  return all[username];
}

export function getProgress(username = currentUsername()) {
  if (!username) return structuredClone(EMPTY_PROGRESS);
  return { ...structuredClone(EMPTY_PROGRESS), ...(getAllProgress()[username] || {}) };
}

/** Merge-style update: never overwrites the whole progress blob. */
export function updateProgress(mutator, username = currentUsername()) {
  if (!username) return null;
  const all = getAllProgress();
  const current = { ...structuredClone(EMPTY_PROGRESS), ...(all[username] || {}) };
  const next = mutator(current) || current;
  next.updated = new Date().toISOString();
  all[username] = next;
  saveAllProgress(all);
  return next;
}

/** Awards XP for a level once. Returns {awarded, xp, newBadges}. */
export function completeLevel(levelId, xp = 10) {
  const username = currentUsername();
  if (!username) return { awarded: false, reason: "guest" };
  const before = getProgress(username);
  if (before.levels[levelId]) return { awarded: false, reason: "already", xp: before.xp };

  let newBadges = [];
  const after = updateProgress((p) => {
    p.levels[levelId] = { at: new Date().toISOString(), xp };
    p.xp += xp;
    newBadges = grantBadges(p);
    return p;
  });
  touchStreak(username);
  return { awarded: true, xp: after.xp, gained: xp, newBadges };
}

export function visitPlanet(id) {
  if (!currentUsername()) return null;
  let gained = 0;
  const p = updateProgress((prog) => {
    if (!prog.planets.includes(id)) {
      prog.planets.push(id);
      prog.xp += 5;
      gained = 5;
      grantBadges(prog);
    }
    return prog;
  });
  return { gained, xp: p.xp, planets: p.planets };
}

export function recordQuiz(score, total, answers) {
  return updateProgress((p) => {
    p.quiz.attempts += 1;
    p.quiz.lastAnswers = answers;
    p.quiz.lastTotal = total;
    p.quiz.lastScore = score;
    if (score > p.quiz.best) {
      p.xp += (score - p.quiz.best) * 4;
      p.quiz.best = score;
    }
    grantBadges(p);
    return p;
  });
}

export function saveReflection(text) {
  return updateProgress((p) => {
    const first = !p.reflection.trim() && text.trim().length >= 40;
    p.reflection = text;
    if (first) p.xp += 20;
    grantBadges(p);
    return p;
  });
}

function touchStreak(username) {
  updateProgress((p) => {
    const today = new Date().toDateString();
    const last = p.streak.last;
    if (last !== today) {
      const yesterday = new Date(Date.now() - 864e5).toDateString();
      p.streak.count = last === yesterday ? p.streak.count + 1 : 1;
      p.streak.last = today;
    }
    return p;
  }, username);
}

/* -------------------------------------------------------- Badges */
export const BADGES = [
  { id: "first-step", icon: "👣", name: "First Step", test: (p) => Object.keys(p.levels).length >= 1 },
  { id: "thorn-heart", icon: "🪶", name: "Thorn Heart", test: (p) => countLevels(p, "thorn") >= 8 },
  { id: "ice-mind", icon: "🐧", name: "Ice Mind", test: (p) => countLevels(p, "penguin") >= 11 },
  { id: "explorer", icon: "🔭", name: "Orbit Explorer", test: (p) => p.planets.length >= 5 },
  { id: "grand-tour", icon: "🪐", name: "Grand Tour", test: (p) => p.planets.length >= 10 },
  { id: "quiz-ace", icon: "🎯", name: "Quiz Ace", test: (p) => p.quiz.best >= 8 },
  { id: "philosopher", icon: "📜", name: "Philosopher", test: (p) => (p.reflection || "").trim().length >= 120 },
  { id: "streak", icon: "🔥", name: "Constant Star", test: (p) => p.streak.count >= 3 },
  { id: "cosmic-master", icon: "👑", name: "Cosmic Master", test: (p) => p.xp >= 400 },
];

const countLevels = (p, prefix) =>
  Object.keys(p.levels).filter((id) => id.startsWith(prefix)).length;

function grantBadges(p) {
  const gained = [];
  for (const badge of BADGES) {
    if (!p.badges.includes(badge.id) && badge.test(p)) {
      p.badges.push(badge.id);
      gained.push(badge);
    }
  }
  return gained;
}

/* ------------------------------------------------------ Rankings */
export function leaderboard() {
  const users = getUsers();
  const all = getAllProgress();
  return Object.keys(all)
    .map((name) => {
      const p = { ...structuredClone(EMPTY_PROGRESS), ...all[name] };
      return {
        username: name,
        avatar: users[name]?.avatar || "🚀",
        xp: p.xp,
        levels: Object.keys(p.levels).length,
        planets: p.planets.length,
        badges: p.badges.length,
        quiz: p.quiz.best,
        streak: p.streak.count,
        rank: rankTitle(p.xp),
      };
    })
    .sort((a, b) => b.xp - a.xp || b.levels - a.levels || a.username.localeCompare(b.username));
}

export function rankTitle(xp) {
  if (xp >= 400) return "Cosmic Master";
  if (xp >= 260) return "Star Navigator";
  if (xp >= 150) return "Orbit Pilot";
  if (xp >= 70) return "Cadet";
  return "Stardust";
}

/* ------------------------------------------------------ Settings */
const DEFAULT_SETTINGS = {
  theme: "nebula",
  scale: 1,
  readable: false,
  narration: true,
  voiceCommands: false,
  rate: 1,
};
export const getSettings = () => ({ ...DEFAULT_SETTINGS, ...read(K.settings, DEFAULT_SETTINGS) });
export const saveSettings = (patch) => {
  const next = { ...getSettings(), ...patch };
  write(K.settings, next);
  return next;
};

/* -------------------------------------------- Export / import 💾 */
export function exportData() {
  return JSON.stringify(
    {
      app: "beyond-orbit",
      version: 2,
      exported: new Date().toISOString(),
      users: getUsers(),
      progress: getAllProgress(),
      settings: getSettings(),
    },
    null,
    2
  );
}

export function importData(json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  if (data.app !== "beyond-orbit") throw new Error("This file is not a Beyond Orbit capsule.");
  saveUsers({ ...getUsers(), ...(data.users || {}) });
  const merged = getAllProgress();
  for (const [name, p] of Object.entries(data.progress || {})) {
    const existing = merged[name];
    merged[name] = !existing || (p.xp || 0) > (existing.xp || 0) ? p : existing;
  }
  saveAllProgress(merged);
  if (data.settings) saveSettings(data.settings);
  return Object.keys(data.users || {}).length;
}

/** Demo cadets so the leaderboard is never a lonely void. */
export function seedDemoUsers() {
  if (localStorage.getItem("bo_seeded")) return;
  const demo = [
    ["NOVA", "🌟", 265, 14, 7, 5, 6],
    ["ARYABHATA", "🛰️", 190, 11, 5, 4, 3],
    ["MICIUS", "🐧", 140, 8, 4, 3, 2],
    ["THORNLING", "🪶", 95, 6, 3, 2, 1],
  ];
  const users = getUsers();
  const progress = getAllProgress();
  for (const [name, avatar, xp, levels, planets, badges, quiz] of demo) {
    if (users[name]) continue;
    users[name] = { username: name, email: `${name.toLowerCase()}@beyondorbit.space`, pass: hashPassword("cosmos"), avatar, joined: new Date().toISOString() };
    progress[name] = {
      ...structuredClone(EMPTY_PROGRESS),
      xp,
      levels: Object.fromEntries(Array.from({ length: levels }, (_, i) => [`seed-${i}`, { xp: 10 }])),
      planets: Array.from({ length: planets }, (_, i) => `p${i}`),
      badges: BADGES.slice(0, badges).map((b) => b.id),
      quiz: { best: quiz, attempts: 1, lastAnswers: [] },
      streak: { count: 2, last: null },
    };
  }
  saveUsers(users);
  saveAllProgress(progress);
  localStorage.setItem("bo_seeded", "1");
}
