import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionsStore, resolveSession } from "./sessions";
import { UsersStore } from "./usersStore";

describe("SessionsStore", () => {
  let dir: string;
  let sessions: SessionsStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rollforge-sessions-"));
    sessions = new SessionsStore(join(dir, "sessions.db"));
  });

  afterEach(() => {
    sessions.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates an unguessable opaque id and reads it back", () => {
    const a = sessions.create("alice");
    const b = sessions.create("alice");
    expect(a.id).not.toEqual(b.id);
    expect(a.id.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
    expect(a.id).not.toContain("alice");
    expect(sessions.get(a.id)?.userId).toBe("alice");
  });

  it("returns null for an unknown id", () => {
    expect(sessions.get("nope")).toBeNull();
  });

  it("treats an expired session as gone and drops the row", () => {
    const s = sessions.create("alice", -1);
    expect(sessions.get(s.id)).toBeNull();
    expect(sessions.get(s.id)).toBeNull(); // still gone, no throw
  });

  it("revokes on delete", () => {
    const s = sessions.create("alice");
    expect(sessions.delete(s.id)).toBe(true);
    expect(sessions.get(s.id)).toBeNull();
    expect(sessions.delete(s.id)).toBe(false);
  });

  it("revokes every session of a user at once", () => {
    sessions.create("alice");
    sessions.create("alice");
    sessions.create("bob");
    expect(sessions.deleteAllFor("alice")).toBe(2);
    expect(sessions.create("bob").id).toBeTruthy();
  });

  it("sweeps expired rows on create", () => {
    sessions.create("old", -1);
    sessions.create("fresh");
    // If the sweep did not run, the dead row would still be on disk. Read the
    // table directly rather than adding a count() method that only tests use.
    const db = (sessions as unknown as { db: { prepare(q: string): { all(): unknown[] } } }).db;
    expect(db.prepare("SELECT id FROM sessions").all()).toHaveLength(1);
  });

  it("survives a reopen", () => {
    const s = sessions.create("alice");
    sessions.close();
    sessions = new SessionsStore(join(dir, "sessions.db"));
    expect(sessions.get(s.id)?.userId).toBe("alice");
  });
});

describe("resolveSession", () => {
  let dir: string;
  let users: UsersStore;
  let sessions: SessionsStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rollforge-sessions-"));
    users = new UsersStore(join(dir, "users.db"));
    users.createUser("alice", "hash", "GM");
    users.createUser("bob", "hash", "Player");
    sessions = new SessionsStore(join(dir, "sessions.db"));
  });

  afterEach(() => {
    users.close();
    sessions.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves a cookie value to the user's current role", () => {
    const s = sessions.create("bob");
    expect(resolveSession(sessions, users, s.id)).toEqual({ sub: "bob", role: "Player" });
  });

  it("reflects a role change without a new login", () => {
    const s = sessions.create("bob");
    // There is no store method to change a role yet (only the first-user
    // bootstrap sets one), so promote through SQL.
    const db = (users as unknown as { db: { prepare(q: string): { run(v: string): unknown } } }).db;
    db.prepare("UPDATE users SET role = 'GM' WHERE username = ?").run("bob");
    expect(resolveSession(sessions, users, s.id)?.role).toBe("GM");
  });

  it("returns null once the session is revoked", () => {
    const s = sessions.create("alice");
    sessions.delete(s.id);
    expect(resolveSession(sessions, users, s.id)).toBeNull();
  });

  it("drops a session whose user no longer exists", () => {
    const s = sessions.create("bob");
    users.deleteUser("bob");
    expect(resolveSession(sessions, users, s.id)).toBeNull();
    expect(sessions.get(s.id)).toBeNull();
  });

  it("returns null without a cookie value", () => {
    expect(resolveSession(sessions, users, undefined)).toBeNull();
  });
});
