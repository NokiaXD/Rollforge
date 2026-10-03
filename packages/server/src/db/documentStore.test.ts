import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database, { type Database as DB } from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentStore } from "./documentStore";
import type { Document } from "@rollforge/protocol";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rollforge-db-"));
  dbPath = join(dir, "world.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function openTestDb(path: string): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

const sampleToken = (id: string): Omit<Document, "_rev"> => ({
  id,
  type: "Token",
  name: id,
  system: { sceneId: "scene-1", x: 0, y: 0, w: 1, h: 1 },
  flags: {},
  ownership: {},
  schemaVersion: 0,
  migrationStatus: "ok",
});

describe("DocumentStore", () => {
  it("save then getById round-trips a document", () => {
    const db = openTestDb(dbPath);
    const store = new DocumentStore(db);
    const saved = store.save(sampleToken("tok-1"));
    expect(saved._rev).toBe(0);

    const fetched = store.getById("tok-1");
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe("tok-1");
    expect(fetched?._rev).toBe(0);
    db.close();
  });

  it("survives a restart with identical state", () => {
    {
      const db = openTestDb(dbPath);
      const a = new DocumentStore(db);
      a.save(sampleToken("tok-a"));
      const moved = a.update(
        {
          ...sampleToken("tok-a"),
          _rev: 0,
          system: { sceneId: "scene-1", x: 5, y: 10, w: 1, h: 1 },
        },
        0,
      );
      expect(moved._rev).toBe(1);
      db.close();
    }

    {
      const db = openTestDb(dbPath);
      const b = new DocumentStore(db);
      const doc = b.getById<{ sceneId: string; x: number; y: number; w: number; h: number }>("tok-a");
      expect(doc).not.toBeNull();
      expect(doc?._rev).toBe(1);
      expect(doc?.system.x).toBe(5);
      expect(doc?.system.y).toBe(10);
      db.close();
    }
  });

  it("update rejects stale _rev", () => {
    const db = openTestDb(dbPath);
    const store = new DocumentStore(db);
    const saved = store.save(sampleToken("tok-2"));
    expect(() => store.update({ ...saved, name: "renamed" }, 99)).toThrow(/stale _rev/);
    db.close();
  });

  it("save rejects duplicate id", () => {
    const db = openTestDb(dbPath);
    const store = new DocumentStore(db);
    store.save(sampleToken("dup"));
    expect(() => store.save(sampleToken("dup"))).toThrow(/already exists/);
    db.close();
  });

  it("getByType filters by document type", () => {
    const db = openTestDb(dbPath);
    const store = new DocumentStore(db);
    store.save(sampleToken("t-1"));
    store.save(sampleToken("t-2"));
    store.save({
      id: "s-1",
      type: "Scene",
      name: "Tavern",
      system: { width: 20, height: 20, background: null, grid: { size: 50, color: "#000", type: "square" } },
      flags: {},
      ownership: {},
    });
    expect(store.getByType("Token")).toHaveLength(2);
    expect(store.getByType("Scene")).toHaveLength(1);
    db.close();
  });

  it("delete removes a document", () => {
    const db = openTestDb(dbPath);
    const store = new DocumentStore(db);
    store.save(sampleToken("gone"));
    expect(store.delete("gone")).toBe(true);
    expect(store.getById("gone")).toBeNull();
    expect(store.delete("gone")).toBe(false);
    db.close();
  });

  it("defaults schemaVersion to 0 and migrationStatus to 'ok' on save with no callback", () => {
    const db = openTestDb(dbPath);
    const store = new DocumentStore(db);
    const saved = store.save(sampleToken("plain"));
    expect(saved.schemaVersion).toBe(0);
    expect(saved.migrationStatus).toBe("ok");
    db.close();
  });

  it("resolves schemaVersion from getCurrentSchemaVersion callback when caller omits it", () => {
    const db = openTestDb(dbPath);
    const store = new DocumentStore(db, {
      getCurrentSchemaVersion: (type) => (type === "Actor" ? 7 : undefined),
    });
    const saved = store.save({
      id: "npc-1",
      type: "Actor",
      name: "Goblin",
      system: { hp: 7 },
      flags: {},
      ownership: {},
    });
    expect(saved.schemaVersion).toBe(7);
    expect(saved.migrationStatus).toBe("ok");
    db.close();
  });

  it("respects caller-provided schemaVersion over the callback default", () => {
    const db = openTestDb(dbPath);
    const store = new DocumentStore(db, {
      getCurrentSchemaVersion: () => 7,
    });
    const saved = store.save({
      ...sampleToken("explicit"),
      schemaVersion: 4,
    });
    expect(saved.schemaVersion).toBe(4);
    db.close();
  });

  it("round-trips schemaVersion and migrationStatus through update", () => {
    const db = openTestDb(dbPath);
    const store = new DocumentStore(db);
    const saved = store.save(sampleToken("rt"));
    const moved = store.update(
      { ...saved, schemaVersion: 2, migrationStatus: "blocked" },
      saved._rev,
    );
    expect(moved.schemaVersion).toBe(2);
    expect(moved.migrationStatus).toBe("blocked");

    const refetched = store.getById("rt");
    expect(refetched?.schemaVersion).toBe(2);
    expect(refetched?.migrationStatus).toBe("blocked");
    db.close();
  });

  it("save rejects invalid id formats (path traversal, special chars, empty)", () => {
    const db = openTestDb(dbPath);
    const store = new DocumentStore(db);
    expect(() => store.save(sampleToken("../evil"))).toThrow(/invalid document id/);
    expect(() => store.save(sampleToken("path/slash"))).toThrow(/invalid document id/);
    expect(() => store.save(sampleToken("with space"))).toThrow(/invalid document id/);
    expect(() => store.save(sampleToken(""))).toThrow(/invalid document id/);
    expect(() => store.save(sampleToken("a".repeat(129)))).toThrow(/invalid document id/);
    db.close();
  });
});

