import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database, { type Database as DB } from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExtensionManager } from "./manager";
import { ChatCommandRegistry } from "./registry";
import { HooksEngine } from "@rollforge/extension-api";
import { DocumentStore } from "../db/documentStore";
import { migrate } from "../db/migrations";
import type { ExtensionManifest, MigrationStep } from "@rollforge/protocol";

let dir: string;
let dbPath: string;
let db: DB;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rollforge-mgr-"));
  dbPath = join(dir, "world.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
});

afterEach(() => {
  try {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function makeManager(): { manager: ExtensionManager; store: DocumentStore } {
  const hooks = new HooksEngine();
  const commandRegistry = new ChatCommandRegistry();
  const store = new DocumentStore(db);
  const manager = new ExtensionManager({
    hooks,
    commandRegistry,
    activationTimeoutMs: 1000,
    getDocumentStore: () => store,
    getDocumentDb: () => db,
  });
  return { manager, store };
}

const sheetsManifest: ExtensionManifest = {
  id: "sheets-ext",
  name: "Sheets",
  version: "1.0.0",
  engines: { core: ">=0.1.0" },
  activationEvents: ["onReady"],
  contributes: {
    documentTypes: [{ id: "cpr-character", base: "Actor", schemaVersion: 2 }],
  },
};

describe("ExtensionManager migration wiring", () => {
  it("runs eager migration on activation: doc v1 -> v2 via registerMigrations in activate", async () => {
    const { manager, store } = makeManager();

    // Seed a doc at v1 before the extension activates
    store.save({
      id: "npc-1",
      type: "cpr-character",
      name: "Goblin",
      system: { hp: 7 },
      flags: {},
      ownership: { default: "LIMITED" },
      schemaVersion: 1,
    });

    const chain: MigrationStep<any>[] = [
      { from: 1, to: 2, up: (s) => ({ ...s, hp: s.hp + 1, notes: "migrated" }) },
    ];

    manager.registerExtension({
      manifest: sheetsManifest,
      activate: (api) => {
        api.documents.registerMigrations("cpr-character", chain);
      },
    });

    await manager.ensureActivated("sheets-ext");
    expect(manager.getExtension("sheets-ext")?.state).toBe("Active");

    const refetched = store.getById("npc-1");
    expect(refetched?.schemaVersion).toBe(2);
    expect(refetched?.migrationStatus).toBe("ok");
    expect((refetched?.system as any).hp).toBe(8);
    expect((refetched?.system as any).notes).toBe("migrated");
  });

  it("per-doc failure marks document blocked but extension stays Active and other docs still migrate", async () => {
    const { manager, store } = makeManager();

    store.save({
      id: "bad",
      type: "cpr-character",
      name: "Bad",
      system: { hp: 1 },
      flags: {},
      ownership: { default: "LIMITED" },
      schemaVersion: 1,
    });
    store.save({
      id: "good",
      type: "cpr-character",
      name: "Good",
      system: { hp: 99 },
      flags: {},
      ownership: { default: "LIMITED" },
      schemaVersion: 1,
    });

    const chain: MigrationStep<any>[] = [
      { from: 1, to: 2, up: (s) => { if (s.hp === 1) throw new Error("nope"); return { ...s, hp: s.hp + 1 }; } },
    ];

    manager.registerExtension({
      manifest: sheetsManifest,
      activate: (api) => {
        api.documents.registerMigrations("cpr-character", chain);
      },
    });

    await manager.ensureActivated("sheets-ext");

    expect(manager.getExtension("sheets-ext")?.state).toBe("Active");

    expect(store.getById("bad")?.migrationStatus).toBe("blocked");
    expect(store.getById("bad")?.schemaVersion).toBe(1);
    expect(store.getById("good")?.migrationStatus).toBe("ok");
    expect(store.getById("good")?.schemaVersion).toBe(2);
    expect((store.getById("good")?.system as any).hp).toBe(100);
  });

  it("rejects registerMigrations for a documentType not contributed by the extension", async () => {
    const { manager } = makeManager();

    let captured: any = null;
    manager.registerExtension({
      manifest: sheetsManifest,
      activate: (api) => {
        captured = api.documents.registerMigrations("rival-character", [
          { from: 1, to: 2, up: (s: any) => s },
        ]);
      },
    });

    await manager.ensureActivated("sheets-ext");
    expect(captured.ok).toBe(false);
    if (!captured.ok) expect(captured.reason).toContain("not contributed");
  });

  it("rejects registerMigrations when chain shape is invalid (hole)", async () => {
    const { manager } = makeManager();

    let captured: any = null;
    manager.registerExtension({
      manifest: sheetsManifest,
      activate: (api) => {
        captured = api.documents.registerMigrations("cpr-character", [
          { from: 1, to: 3, up: (s: any) => s },
        ]);
      },
    });

    await manager.ensureActivated("sheets-ext");
    expect(captured.ok).toBe(false);
    if (!captured.ok) expect(captured.reason).toContain("not a single-version bump");
  });

  it("re-run after a previously failed step is fixed: blocked doc recovers", async () => {
    const { manager, store } = makeManager();

    store.save({
      id: "r",
      type: "cpr-character",
      name: "r",
      system: { hp: 1 },
      flags: {},
      ownership: { default: "LIMITED" },
      schemaVersion: 1,
    });

    let phase = 0;
    manager.registerExtension({
      manifest: sheetsManifest,
      activate: (api) => {
        if (phase === 0) {
          api.documents.registerMigrations("cpr-character", [
            { from: 1, to: 2, up: () => { throw new Error("bug"); } },
          ]);
        } else {
          api.documents.registerMigrations("cpr-character", [
            { from: 1, to: 2, up: (s: any) => ({ ...s, hp: s.hp + 10 }) },
          ]);
        }
      },
    });

    await manager.ensureActivated("sheets-ext");
    expect(store.getById("r")?.migrationStatus).toBe("blocked");

    // Deactivate + retry with the fixed chain
    phase = 1;
    await manager.deactivateExtension("sheets-ext");
    await manager.retryExtension("sheets-ext");

    const final = store.getById("r");
    expect(final?.schemaVersion).toBe(2);
    expect(final?.migrationStatus).toBe("ok");
    expect((final?.system as any).hp).toBe(11);
  });
});