import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockApi, ApiError } from "../src/api.js";
import { memoryStorage } from "../src/storage.js";
import { Story, StoryList, User, SESSION_KEY } from "../src/models.js";

const setup = () => { const storage = memoryStorage(), api = createMockApi({ storage }); return { storage, api }; };
const URL1 = "https://example.com/a";
const mk = async (api, storage, name = "ada_l") => User.signup(api, storage, name, "correct-horse", "Ada");
const rejects = (p, code) => assert.rejects(p, e => e instanceof ApiError && e.code === code);

test("passwords are salted and hashed, never stored in plaintext", async () => {
  const { api, storage } = setup(); await mk(api, storage);
  const raw = storage.getItem("hos:db");
  assert.ok(!raw.includes("correct-horse")); assert.match(raw, /"salt":"[0-9a-f]{32}"/);
});
test("duplicate usernames are rejected with a typed error", async () => {
  const { api, storage } = setup(); await mk(api, storage); await rejects(mk(api, storage), "USERNAME_TAKEN");
});
test("weak passwords and bad usernames fail validation", async () => {
  const { api } = setup();
  await rejects(api.signup("ada_l", "short", "A"), "VALIDATION"); await rejects(api.signup("a b", "long-enough-pw", "A"), "VALIDATION");
});
test("wrong password and unknown user return the same error", async () => {
  const { api, storage } = setup(); await mk(api, storage);
  await rejects(api.login("ada_l", "nope-nope-nope"), "BAD_CREDENTIALS"); await rejects(api.login("ghost", "nope-nope-nope"), "BAD_CREDENTIALS");
});
test("tokens are opaque and cannot be forged from a username", async () => {
  const { api, storage } = setup(); const u = await mk(api, storage);
  assert.ok(!u.token.includes("ada_l")); await rejects(api.getUser("tok_ada_l"), "UNAUTHORIZED");
});
test("logout invalidates the server session", async () => {
  const { api, storage } = setup(); const u = await mk(api, storage); await u.logout(storage);
  assert.equal(storage.getItem(SESSION_KEY), null); await rejects(api.getUser(u.token), "UNAUTHORIZED");
});
test("restore clears a stale token instead of staying half-authenticated", async () => {
  const { api, storage } = setup(); storage.setItem(SESSION_KEY, "stale");
  assert.equal(await User.restore(api, storage), null); assert.equal(storage.getItem(SESSION_KEY), null);
});
test("addStory validates title and rejects non-http URLs", async () => {
  const { api, storage } = setup(); const u = await mk(api, storage);
  await rejects(api.addStory(u.token, { title: "", author: "x", url: URL1 }), "VALIDATION");
  await rejects(api.addStory(u.token, { title: "t", author: "x", url: "javascript:alert(1)" }), "VALIDATION");
});
test("StoryList.add prepends the new story", async () => {
  const { api, storage } = setup(); const u = await mk(api, storage), list = await StoryList.load(api);
  const s = await list.add(u, { title: "Hello", author: "Ada", url: URL1 }); assert.equal(list.stories[0], s);
});
test("only the owner can delete; deleting also clears favorites", async () => {
  const { api, storage } = setup(); const a = await mk(api, storage), b = await mk(api, storage, "bob_k"), list = await StoryList.load(api);
  const s = await list.add(a, { title: "T", author: "A", url: URL1 }); await b.toggleFavorite(s.storyId);
  await rejects(list.remove(b, s.storyId), "FORBIDDEN"); await list.remove(a, s.storyId);
  assert.equal((await api.getUser(b.token)).favorites.length, 0);
});
test("toggleFavorite does not change local state when the server rejects", async () => {
  const { api, storage } = setup(); const u = await mk(api, storage);
  await rejects(u.toggleFavorite("missing"), "NOT_FOUND"); assert.equal(u.favoriteIds.size, 0);
});
test("Story helpers: hostname normalisation and injected-clock time labels", () => {
  const t0 = Date.parse("2026-01-01T00:00:00Z");
  const s = new Story({ storyId: "1", title: "T", author: "A", url: "https://www.mdn.dev/x", username: "u", createdAt: new Date(t0).toISOString() });
  assert.equal(s.getHostName(), "mdn.dev"); assert.equal(s.timeAgo(t0 + 3 * 3600e3), "3 hours ago");
  assert.equal(new Story({ ...s, url: "nope" }).getHostName(), "");
});
