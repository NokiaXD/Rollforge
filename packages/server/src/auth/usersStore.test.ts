import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsersStore } from "./usersStore";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rollforge-users-"));
  path = join(dir, "users.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("UsersStore", () => {
  it("isFirstUser starts true, false after creation", () => {
    const users = new UsersStore(path);
    expect(users.isFirstUser()).toBe(true);
    users.createUser("alice", "h", "GM");
    expect(users.isFirstUser()).toBe(false);
    users.close();
  });

  it("createUser rejects duplicate username", () => {
    const users = new UsersStore(path);
    users.createUser("bob", "h", "Player");
    expect(() => users.createUser("bob", "h", "Player")).toThrow(/already exists/);
    users.close();
  });

  it("getByUsername returns null for missing user", () => {
    const users = new UsersStore(path);
    expect(users.getByUsername("nope")).toBeNull();
    users.close();
  });

  it("setPasswordHash updates the hash", () => {
    const users = new UsersStore(path);
    users.createUser("carol", "old", "Player");
    expect(users.setPasswordHash("carol", "new")).toBe(true);
    expect(users.getByUsername("carol")?.passwordHash).toBe("new");
    expect(users.setPasswordHash("ghost", "x")).toBe(false);
    users.close();
  });
});