import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockApi, ApiError } from "../src/api.js";
import { memoryStorage } from "../src/storage.js";
import { Story, StoryList, User, SESSION_KEY } from "../src/models.js";

/**
 * @typedef {Object} TestContext
 * @property {import('../src/storage.js').Storage} storage
 * @property {import('../src/api.js').MockApi} api
 */

/** @returns {TestContext} */
const setup = () => {
  const storage = memoryStorage();
  const api = createMockApi({ storage });
  return { storage, api };
};

const URL_EXAMPLE = "https://example.com/a";

/** 
 * @param {any} api 
 * @param {any} storage 
 * @param {string} [name="ada_l"] 
 */
const createUser = async (api, storage, name = "ada_l") => 
  User.signup(api, storage, name, "correct-horse-battery", "Ada");

const assertRejectsWithCode = (promise, expectedCode) => 
  assert.rejects(promise, (err) => err instanceof ApiError && err.code === expectedCode);

test("Hack or Snooze Domain Core Suite", async (t) => {

  await t.test("Authentication & Security Layer", async (t) => {
    
    await t.test("passwords are salted and hashed, never stored in plaintext", async () => {
      const { api, storage } = setup();
      await createUser(api, storage);
      
      const rawDb = storage.getItem("hos:db");
      assert.ok(rawDb, "Database state should exist in storage");
      assert.ok(!rawDb.includes("correct-horse-battery"), "Plaintext password must never be persisted");
      assert.match(rawDb, /"salt":"[0-9a-f]{32}"/, "Password record must contain a 32-character hex salt");
    });

    await t.test("duplicate usernames are rejected with a typed USERNAME_TAKEN error", async () => {
      const { api, storage } = setup();
      await createUser(api, storage);
      await assertRejectsWithCode(createUser(api, storage), "USERNAME_TAKEN");
    });

    await t.test("weak passwords and malformed usernames fail validation rules", async () => {
      const { api } = setup();
      await assertRejectsWithCode(api.signup("ada_l", "short", "A"), "VALIDATION");
      await assertRejectsWithCode(api.signup("a b", "secure-password-123", "A"), "VALIDATION");
    });

    await t.test("wrong password and unknown user return identical BAD_CREDENTIALS error for security", async () => {
      const { api, storage } = setup();
      await createUser(api, storage);
      
      await assertRejectsWithCode(api.login("ada_l", "wrong-password"), "BAD_CREDENTIALS");
      await assertRejectsWithCode(api.login("nonexistent_user", "any-password"), "BAD_CREDENTIALS");
    });

    await t.test("session tokens are opaque and immune to username-based forgery", async () => {
      const { api, storage } = setup();
      const user = await createUser(api, storage);
      
      assert.ok(!user.token.includes("ada_l"), "Token must not expose plaintext user identity");
      await assertRejectsWithCode(api.getUser("tok_ada_l"), "UNAUTHORIZED");
    });

    await t.test("logout invalidates the server session and clears local store", async () => {
      const { api, storage } = setup();
      const user = await createUser(api, storage);
      
      await user.logout(storage);
      assert.equal(storage.getItem(SESSION_KEY), null, "Session key must be purged from storage");
      await assertRejectsWithCode(api.getUser(user.token), "UNAUTHORIZED");
    });

    await t.test("session restoration clears stale tokens instead of hanging half-authenticated", async () => {
      const { api, storage } = setup();
      storage.setItem(SESSION_KEY, "stale_token_xyz");
      
      const restoredUser = await User.restore(api, storage);
      assert.equal(restoredUser, null, "Stale restore should resolve to null");
      assert.equal(storage.getItem(SESSION_KEY), null, "Stale token must be automatically cleaned up");
    });
  });

  await t.test("Story & Interaction Management Layer", async (t) => {
    
    await t.test("story submission enforces title presence and http/https URL schemes", async () => {
      const { api, storage } = setup();
      const user = await createUser(api, storage);
      
      await assertRejectsWithCode(
        api.addStory(user.token, { title: "", author: "Author", url: URL_EXAMPLE }), 
        "VALIDATION"
      );
      await assertRejectsWithCode(
        api.addStory(user.token, { title: "Title", author: "Author", url: "javascript:alert(1)" }), 
        "VALIDATION"
      );
    });

    await t.test("StoryList.add successfully prepends new stories to the reactive list", async () => {
      const { api, storage } = setup();
      const user = await createUser(api, storage);
      const list = await StoryList.load(api);
      
      const newStory = await list.add(user, { title: "Resilient UI State", author: "Wisdom", url: URL_EXAMPLE });
      assert.equal(list.stories[0], newStory, "New story must be prepended at the index 0 position");
    });

    await t.test("deletion authorization limits owners and cascades favorite cleanups", async () => {
      const { api, storage } = setup();
      const owner = await createUser(api, storage, "owner_u");
      const outsider = await createUser(api, storage, "outsider_u");
      const list = await StoryList.load(api);
      
      const story = await list.add(owner, { title: "Architecture", author: "Wisdom", url: URL_EXAMPLE });
      await outsider.toggleFavorite(story.storyId);
      
      await assertRejectsWithCode(list.remove(outsider, story.storyId), "FORBIDDEN");
      await list.remove(owner, story.storyId);
      
      const outsiderRecord = await api.getUser(outsider.token);
      assert.equal(outsiderRecord.favorites.length, 0, "Deleting a story should automatically clear it from user favorites");
    });

    await t.test("toggleFavorite maintains strict consistency when server rejects mutations", async () => {
      const { api, storage } = setup();
      const user = await createUser(api, storage);
      
      await assertRejectsWithCode(user.toggleFavorite("non-existent-id"), "NOT_FOUND");
      assert.equal(user.favoriteIds.size, 0, "Local state must not change if server operation fails");
    });

    await t.test("Story domain helpers handle hostname extraction and injected-clock calculations", () => {
      const baseTime = Date.parse("2026-01-01T12:00:00Z");
      const story = new Story({
        storyId: "s1",
        title: "Test Story",
        author: "Dev",
        url: "https://www.sub.example.org/path?query=1",
        username: "ada_l",
        createdAt: new Date(baseTime).toISOString()
      });

      assert.equal(story.getHostName(), "sub.example.org", "Host should strip protocol and www prefix");
      assert.equal(story.timeAgo(baseTime + 2 * 3600e3), "2 hours ago", "Time label must respect injected clock");
      
      const invalidStory = new Story({ ...story, url: "malformed-url" });
      assert.equal(invalidStory.getHostName(), "", "Malformed URLs should safely return an empty string");
    });
  });

});