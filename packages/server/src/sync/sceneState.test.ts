import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentStore } from "../db/documentStore";
import { openWorldDb } from "../db/connection";
import { SceneState } from "./sceneState";
import type { Database as DB } from "better-sqlite3";

let dir: string;
let dbPath: string;
let openDbs: DB[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rollforge-state-"));
  dbPath = join(dir, "world.db");
  openDbs = [];
});

afterEach(() => {
  for (const db of openDbs) db.close();
  rmSync(dir, { recursive: true, force: true });
});

function openDb(): DB {
  const db = openWorldDb(dbPath);
  openDbs.push(db);
  return db;
}

// Paso 7 verification: create tokens, "restart" the server (close + reopen the store),
// confirm state is identical.
describe("SceneState persistence", () => {
  it("tokens survive a server restart via DocumentStore", () => {
    const db1 = openDb();
    const store1 = new DocumentStore(db1);
    const state1 = new SceneState({ store: store1 });
    state1.createToken("tok-1", "scene-1", 3, 4);
    state1.createToken("tok-2", "scene-1", 7, 8);
    db1.close();
    openDbs.length = 0;

    const db2 = openDb();
    const store2 = new DocumentStore(db2);
    const state2 = new SceneState({ store: store2 });
    const tokens = state2.getSceneTokens("scene-1");

    expect(tokens).toHaveLength(2);
    const t1 = state2.getToken("tok-1");
    expect(t1?.x).toBe(3);
    expect(t1?.y).toBe(4);
    expect(t1?._rev).toBe(0);
  });

it("moveToken persists new position and bumps _rev", () => {
    const db = openDb();
    const store = new DocumentStore(db);
    const state = new SceneState({ store });
    state.createToken("tok-m", "scene-1", 0, 0);

    const moved = state.moveToken("tok-m", "user-1", 10, 20, 0);
    expect(moved?._rev).toBe(1);

    const doc = store.getById<{ sceneId: string; x: number; y: number; w: number; h: number }>("tok-m");
    expect(doc?.system.x).toBe(10);
    expect(doc?.system.y).toBe(20);
    expect(doc?._rev).toBe(1);
  });

  it("rejects moveToken on stale _rev or when locked by another user", () => {
    const db = openDb();
    const store = new DocumentStore(db);
    const state = new SceneState({ store });
    state.createToken("tok-stale", "scene-1", 0, 0);

    // Initial move succeeds: _rev becomes 1
    const moved = state.moveToken("tok-stale", "alice", 1, 1, 0);
    expect(moved?._rev).toBe(1);

    // Stale _rev rejected: passes expectedRev 0 when current is 1
    const stale = state.moveToken("tok-stale", "alice", 2, 2, 0);
    expect(stale).toBeNull();
    expect(state.getToken("tok-stale")?._rev).toBe(1);

    // Locked by another user rejected
    state.acquireLock("tok-stale", "bob");
    const locked = state.moveToken("tok-stale", "alice", 3, 3, 1);
    expect(locked).toBeNull();
  });

  // Paso 9 verification: ownership must survive restart so authorize() stays consistent.
  it("preserves token ownership across server restart", () => {
    const db1 = openDb();
    const store1 = new DocumentStore(db1);
    const state1 = new SceneState({ store: store1 });
    state1.createToken("tok-pvt", "scene-1", 0, 0, 1, 1, { "alice": "OWNER" });
    state1.createToken("tok-open", "scene-1", 1, 1);
    db1.close();
    openDbs.length = 0;

    const db2 = openDb();
    const store2 = new DocumentStore(db2);
    const state2 = new SceneState({ store: store2 });
    expect(state2.getToken("tok-pvt")?.ownership).toEqual({ alice: "OWNER" });
    expect(state2.getToken("tok-open")?.ownership).toEqual({ default: "LIMITED" });
  });
});

// Paso 10 Phase 2: Scene CRUD persistence + state shape.
describe("SceneState scenes", () => {
  it("auto-seeds a 'default' scene on construction", () => {
    const state = new SceneState();
    const scene = state.getScene("default");
    expect(scene).toBeDefined();
    expect(scene?.system.grid.size).toBe(50);
    expect(scene?.system.width).toBe(25000);
  });

  it("createScene / getScene / listScenes round-trip", () => {
    const state = new SceneState();
    state.createScene("tavern", "The Tavern", {
      width: 5000,
      height: 3000,
      background: "#222",
      grid: { size: 70, color: 0xff00ff, type: "hex" },
    });
    const tavern = state.getScene("tavern");
    expect(tavern?.name).toBe("The Tavern");
    expect(tavern?.system.grid.size).toBe(70);
    expect(tavern?.system.grid.type).toBe("hex");
    const all = state.listScenes().map((s) => s.id).sort();
    expect(all).toEqual(["default", "tavern"]);
  });

  it("createScene falls back to sceneId when name is empty", () => {
    const state = new SceneState();
    state.createScene("tavern", "", {
      width: 1,
      height: 1,
      background: null,
      grid: { size: 50, color: 0, type: "square" },
    });
    expect(state.getScene("tavern")?.name).toBe("tavern");
  });

  it("createScene throws on duplicate id", () => {
    const state = new SceneState();
    expect(() =>
      state.createScene("default", "x", { width: 1, height: 1, background: null, grid: { size: 50, color: 0, type: "square" } }),
    ).toThrow();
  });

  it("updateScene mutates name and system and bumps _rev", () => {
    const state = new SceneState();
    const updated = state.updateScene("default", "Renamed", {
      width: 8000,
      height: 8000,
      background: null,
      grid: { size: 100, color: 0xff0000, type: "square" },
    });
    expect(updated?._rev).toBe(1);
    expect(updated?.name).toBe("Renamed");
    expect(state.getScene("default")?.system.grid.size).toBe(100);
  });

  it("updateScene returns null for unknown id", () => {
    const state = new SceneState();
    expect(state.updateScene("ghost", "x", { width: 1, height: 1, background: null, grid: { size: 50, color: 0, type: "square" } })).toBeNull();
  });

  it("deleteScene removes a scene", () => {
    const state = new SceneState();
    state.createScene("tavern", "x", { width: 1, height: 1, background: null, grid: { size: 50, color: 0, type: "square" } });
    expect(state.deleteScene("tavern")).toBe(true);
    expect(state.getScene("tavern")).toBeUndefined();
  });

  it("scenes persist across server restart", () => {
    const db1 = openDb();
    const store1 = new DocumentStore(db1);
    const state1 = new SceneState({ store: store1 });
    state1.createScene("tavern", "The Tavern", {
      width: 5000,
      height: 3000,
      background: "#222",
      grid: { size: 70, color: 0xff00ff, type: "hex" },
    });
    state1.updateScene("tavern", "The Renamed Tavern", {
      width: 6000,
      height: 3000,
      background: "#333",
      grid: { size: 80, color: 0xff00ff, type: "hex" },
    });
    db1.close();
    openDbs.length = 0;

    const db2 = openDb();
    const store2 = new DocumentStore(db2);
    const state2 = new SceneState({ store: store2 });
    const tavern = state2.getScene("tavern");
    expect(tavern?.system.grid.size).toBe(80);
    expect(tavern?.system.width).toBe(6000);
    expect(tavern?.name).toBe("The Renamed Tavern");
    expect(tavern?._rev).toBe(1);
  });
});