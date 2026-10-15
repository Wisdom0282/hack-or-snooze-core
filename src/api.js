// Mock backend behind the same contract a real HTTP adapter would implement.
// Swap by providing another object with these methods; models and UI are unaffected.
const enc = new TextEncoder();
const hex = b => [...b].map(x => x.toString(16).padStart(2, "0")).join("");
const rand = n => hex(crypto.getRandomValues(new Uint8Array(n)));

export class ApiError extends Error {
  constructor(code, message) { super(message); this.name = "ApiError"; this.code = code; }
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 100_000 }, key, 256);
  return hex(new Uint8Array(bits));
}

export function createMockApi({ storage, now = () => Date.now(), key = "hos:db" } = {}) {
  const load = () => { const r = storage.getItem(key); return r ? JSON.parse(r) : { users: {}, sessions: {}, stories: [] }; };
  const save = db => storage.setItem(key, JSON.stringify(db));
  const authed = (db, token) => {
    const u = db.sessions[token];
    if (!u || !db.users[u]) throw new ApiError("UNAUTHORIZED", "Session expired. Log in again.");
    return u;
  };
  const startSession = (db, username) => { const token = rand(24); db.sessions[token] = username; return token; };

  return {
    async getStories() { return [...load().stories].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },

    async signup(username, password, name) {
      const u = String(username).trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(u)) throw new ApiError("VALIDATION", "Username must be 3-20 letters, numbers or underscores.");
      if (String(password).length < 8) throw new ApiError("VALIDATION", "Password must be at least 8 characters.");
      const db = load();
      if (db.users[u]) throw new ApiError("USERNAME_TAKEN", "That username is taken. Try another.");
      const salt = rand(16);
      db.users[u] = { name: String(name).trim(), salt, hash: await hashPassword(password, salt), favorites: [] };
      const token = startSession(db, u); save(db); return { token };
    },

    async login(username, password) {
      const u = String(username).trim().toLowerCase(), db = load(), rec = db.users[u];
      // Hash even for unknown users so response time doesn't reveal which usernames exist.
      const h = await hashPassword(password, rec ? rec.salt : "0".repeat(32));
      if (!rec || h !== rec.hash) throw new ApiError("BAD_CREDENTIALS", "Username or password is incorrect.");
      const token = startSession(db, u); save(db); return { token };
    },

    async logout(token) { const db = load(); delete db.sessions[token]; save(db); },

    async getUser(token) {
      const db = load(), u = authed(db, token);
      return { username: u, name: db.users[u].name, favorites: [...db.users[u].favorites] };
    },

    async addStory(token, { title, author, url }) {
      const db = load(), u = authed(db, token);
      title = String(title ?? "").trim(); author = String(author ?? "").trim();
      if (!title || title.length > 120) throw new ApiError("VALIDATION", "Title is required and must be 120 characters or fewer.");
      if (!author) throw new ApiError("VALIDATION", "Author is required.");
      let parsed; try { parsed = new URL(url); } catch { parsed = null; }
      if (!parsed || !/^https?:$/.test(parsed.protocol)) throw new ApiError("VALIDATION", "Enter a full http or https URL.");
      const story = { storyId: "s" + rand(6), title, author, url: parsed.href, username: u, createdAt: new Date(now()).toISOString() };
      db.stories.push(story); save(db); return story;
    },

    async deleteStory(token, id) {
      const db = load(), u = authed(db, token), s = db.stories.find(x => x.storyId === id);
      if (!s) throw new ApiError("NOT_FOUND", "That story no longer exists.");
      if (s.username !== u) throw new ApiError("FORBIDDEN", "You can only delete your own stories.");
      db.stories = db.stories.filter(x => x.storyId !== id);
      for (const usr of Object.values(db.users)) usr.favorites = usr.favorites.filter(f => f !== id);
      save(db);
    },

    async setFavorite(token, id, on) {
      const db = load(), u = authed(db, token);
      if (!db.stories.some(s => s.storyId === id)) throw new ApiError("NOT_FOUND", "That story no longer exists.");
      const set = new Set(db.users[u].favorites); on ? set.add(id) : set.delete(id);
      db.users[u].favorites = [...set]; save(db);
    }
  };
}
