// Domain models. No DOM, no globals: every dependency (api, storage, clock) is injected.
export const SESSION_KEY = "hos:session";

export class Story {
  constructor({ storyId, title, author, url, username, createdAt }) { Object.assign(this, { storyId, title, author, url, username, createdAt }); }
  getHostName() { try { return new URL(this.url).hostname.replace(/^www\./, ""); } catch { return ""; } }
  timeAgo(now = Date.now()) {
    const s = Math.max(1, Math.floor((now - new Date(this.createdAt)) / 1000));
    for (const [unit, size] of [["day", 86400], ["hour", 3600], ["minute", 60]])
      if (s >= size) { const v = Math.floor(s / size); return `${v} ${unit}${v > 1 ? "s" : ""} ago`; }
    return "just now";
  }
}

export class StoryList {
  constructor(api, stories) { this.api = api; this.stories = stories; }
  static async load(api) { return new StoryList(api, (await api.getStories()).map(s => new Story(s))); }
  async add(user, data) { const s = new Story(await this.api.addStory(user.token, data)); this.stories.unshift(s); return s; }
  async remove(user, id) { await this.api.deleteStory(user.token, id); this.stories = this.stories.filter(s => s.storyId !== id); }
}

export class User {
  constructor(api, { username, name, favorites }, token) { Object.assign(this, { api, username, name, token }); this.favoriteIds = new Set(favorites); }
  static async #open(api, storage, token) { const u = new User(api, await api.getUser(token), token); storage.setItem(SESSION_KEY, token); return u; }
  static async signup(api, storage, username, password, name) { return User.#open(api, storage, (await api.signup(username, password, name)).token); }
  static async login(api, storage, username, password) { return User.#open(api, storage, (await api.login(username, password)).token); }
  static async restore(api, storage) {
    const token = storage.getItem(SESSION_KEY); if (!token) return null;
    try { return await User.#open(api, storage, token); } catch { storage.removeItem(SESSION_KEY); return null; }
  }
  async logout(storage) { storage.removeItem(SESSION_KEY); try { await this.api.logout(this.token); } catch {} }
  isFavorite(id) { return this.favoriteIds.has(id); }
  async toggleFavorite(id) {
    const on = !this.isFavorite(id);
    await this.api.setFavorite(this.token, id, on); // mutate local state only after the server accepts[cite: 6]
    on ? this.favoriteIds.add(id) : this.favoriteIds.delete(id); return on;
  }
}