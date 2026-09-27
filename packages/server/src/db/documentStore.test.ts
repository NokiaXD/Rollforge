import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

const sampleToken = (id: string): Omit<Document, "_rev"> => ({
  id,
  type: "Token",
  name: id,
  system: { sceneId: "scene-1", x: 0, y: 0, w: 1, h: 1 },
  flags: {},
  ownership: {},
});

describe("DocumentStore", () => {
  it("save then getById round-trips a document", () => {
    const store = new DocumentStore(dbPath);
    const saved = store.save(sampleToken("tok-1"));
    expect(saved._rev).toBe(0);

    const fetched = store.getById("tok-1");
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe("tok-1");
    expect(fetched?._rev).toBe(0);
    store.close();
  });

  it("survives a restart with identical state", () => {
    const a = new DocumentStore(dbPath);
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
    a.close();

    const b = new DocumentStore(dbPath);
    const doc = b.getById<{ sceneId: string; x: number; y: number; w: number; h: number }>("tok-a");
    expect(doc).not.toBeNull();
    expect(doc?._rev).toBe(1);
    expect(doc?.system.x).toBe(5);
    expect(doc?.system.y).toBe(10);
    b.close();
  });

  it("update rejects stale _rev", () => {
    const store = new DocumentStore(dbPath);
    const saved = store.save(sampleToken("tok-2"));
    expect(() =>
      store.update({ ...saved, name: "renamed" }, 99),
    ).toThrow(/stale _rev/);
    store.close();
  });

  it("save rejects duplicate id", () => {
    const store = new DocumentStore(dbPath);
    store.save(sampleToken("dup"));
    expect(() => store.save(sampleToken("dup"))).toThrow(/already exists/);
    store.close();
  });

  it("getByType filters by document type", () => {
    const store = new DocumentStore(dbPath);
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
    store.close();
  });

  it("delete removes a document", () => {
    const store = new DocumentStore(dbPath);
    store.save(sampleToken("gone"));
    expect(store.delete("gone")).toBe(true);
    expect(store.getById("gone")).toBeNull();
    expect(store.delete("gone")).toBe(false);
    store.close();
  });
});