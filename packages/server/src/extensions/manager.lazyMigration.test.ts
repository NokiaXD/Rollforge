import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database, { type Database as DB } from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExtensionManager } from "./manager";
import { ChatCommandRegistry } from "./registry";
import { HooksEngine, type ServerExtensionAPI } from "@rollforge/extension-api";
import { DocumentStore } from "../db/documentStore";
import { migrate } from "../db/migrations";
import type { ExtensionManifest, MigrationStep } from "@rollforge/protocol";

// Paso 18 — lazy migration. §12: "Entradas de compendio: lazy, al abrir
// cada una (miles de entradas no deben bloquear el arranque)" and "lock
// efímero en memoria por id de documento".
let dir: string;
let db: DB;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rollforge-lazy-"));
  db = new Database(join(dir, "world.db"));
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
  const store = new DocumentStore(db);
  const manager = new ExtensionManager({
    hooks: new HooksEngine(),
    commandRegistry: new ChatCommandRegistry(),
    activationTimeoutMs: 1000,
    getDocumentStore: () => store,
    getDocumentDb: () => db,
  });
  return { manager, store };
}

// The shape the official compendium extension uses (packages/compendium):
// a read-only wrapper type for the pack entry, and a campaign type for the
// document an import produces. Same chain registered for both, same
// declared version, so a pack entry that migrates to v2 imports as a v2.
const packManifest: ExtensionManifest = {
  id: "compendium",
  name: "Compendium",
  version: "1.0.0",
  engines: { core: ">=0.1.0" },
  activationEvents: ["onReady"],
  contributes: {
    documentTypes: [
      { id: "pack-actor", base: "Actor", schemaVersion: 2, scope: "compendium" },
      { id: "camp-actor", base: "Actor", schemaVersion: 2 },
    ],
  },
};

// A data-dependent step: entries whose v1 system carries `ac` migrate
// fine, the others blow up mid-chain. Same chain for every document of the
// type, so the failure is per-DOCUMENT (Paso 15's blast radius), which is
// exactly the shape the import test needs.
function makeChain(counter: { runs: number }): MigrationStep<any>[] {
  return [
    { from: 0, to: 1, up: (s: any) => ({ ...s, name: s.name ?? "?" }) },
    {
      from: 1,
      to: 2,
      up: (s: any) => {
        counter.runs += 1;
        if (typeof s.ac !== "number") throw new Error("missing ac");
        return { ...s, hpMax: s.ac + 5 };
      },
    },
  ];
}

function seedEntry(
  store: DocumentStore,
  id: string,
  schemaVersion: number,
  system: Record<string, unknown>,
): void {
  store.save({
    id,
    type: "pack-actor",
    name: id,
    system,
    flags: {},
    ownership: {},
    schemaVersion,
  });
}

describe("Paso 18 — lazy migration (scope: compendium)", () => {
  it("does NOT migrate compendium-scoped entries on activation", async () => {
    const { manager, store } = makeManager();
    seedEntry(store, "pack-goblin", 0, { name: "Goblin", ac: 12 });

    manager.registerExtension({
      manifest: packManifest,
      activate: (api) => {
        api.documents.registerMigrations("pack-actor", makeChain({ runs: 0 }));
      },
    });
    await manager.ensureActivated("compendium");

    expect(manager.getExtension("compendium")?.state).toBe("Active");
    // Untouched: §12 wants thousands of entries to cost nothing at boot.
    expect(store.getById("pack-goblin")?.schemaVersion).toBe(0);
  });

  it("still migrates campaign-scoped docs of the same extension eagerly", async () => {
    const { manager, store } = makeManager();
    store.save({
      id: "camp-1",
      type: "camp-actor",
      name: "Imported Goblin",
      system: { name: "Imported Goblin", ac: 12 },
      flags: {},
      ownership: {},
      schemaVersion: 0,
    });
    seedEntry(store, "pack-goblin", 0, { name: "Goblin", ac: 12 });

    manager.registerExtension({
      manifest: packManifest,
      activate: (api) => {
        const chain = makeChain({ runs: 0 });
        api.documents.registerMigrations("pack-actor", chain);
        api.documents.registerMigrations("camp-actor", chain);
      },
    });
    await manager.ensureActivated("compendium");

    expect(store.getById("camp-1")?.schemaVersion).toBe(2);
    expect(store.getById("pack-goblin")?.schemaVersion).toBe(0);
  });

  it("runs the chain ONCE when the eager loop and a lazy read race on the same document", async () => {
    // This is the bug lazy migration made reachable. The eager loop used to
    // read the document, check the version, and run the chain on that
    // snapshot — all OUTSIDE the lock. A concurrent lazy read of a
    // campaign-scoped document migrates it first; the eager caller then
    // enters the lock holding a v0 snapshot and runs 0→2 a second time.
    const { manager, store } = makeManager();
    const counter = { runs: 0 };
    const chain = makeChain(counter);
    let api!: ServerExtensionAPI;

    // Two documents, both campaign-scoped (so eager) — the eager loop will
    // walk them in order, and we hook the chain to fire a lazy read on the
    // second one from inside the first migration.
    store.save({
      id: "camp-a", type: "camp-actor", name: "A",
      system: { name: "A", ac: 10 }, flags: {}, ownership: {}, schemaVersion: 0,
    });
    store.save({
      id: "camp-b", type: "camp-actor", name: "B",
      system: { name: "B", ac: 10 }, flags: {}, ownership: {}, schemaVersion: 0,
    });

    manager.registerExtension({
      manifest: packManifest,
      activate: (a) => {
        api = a;
        a.documents.registerMigrations("camp-actor", [
          {
            from: 0, to: 1,
            up: async (s: any) => {
              counter.runs++;
              // While the eager loop is inside camp-a's migration, a client
              // opens camp-b — which the eager loop is about to reach.
              if (counter.runs === 1) await api.documents.get("camp-b");
              return { ...s, label: s.name };
            },
          },
          { from: 1, to: 2, up: (s: any) => ({ ...s, hpMax: s.ac + 5 }) },
        ] as any);
        // keep the reference reachable; the shared `chain` is unused here
        void chain;
      },
    });
    await manager.ensureActivated("compendium");

    expect(store.getById("camp-b")?.schemaVersion).toBe(2);
    // 0→1 ran once for camp-a and once for camp-b: two documents, two runs.
    // What must NOT happen is camp-b running the chain a second time after
    // the lazy read already migrated it.
    expect(counter.runs).toBe(2);
    expect((store.getById("camp-b")?.system as any).hpMax).toBe(15);
  });

  it("migrates on first read through api.documents.get (inspect)", async () => {
    const { manager, store } = makeManager();
    seedEntry(store, "pack-goblin", 0, { name: "Goblin", ac: 12 });
    let api!: ServerExtensionAPI;

    manager.registerExtension({
      manifest: packManifest,
      activate: (a) => {
        api = a;
        a.documents.registerMigrations("pack-actor", makeChain({ runs: 0 }));
      },
    });
    await manager.ensureActivated("compendium");

    const read = await api.documents.get<{ hpMax: number }>("pack-goblin");
    expect(read?.schemaVersion).toBe(2);
    expect(read?.system.hpMax).toBe(17);
    expect(store.getById("pack-goblin")?.schemaVersion).toBe(2);

    // Idempotent: a second read does not re-run the chain.
    await api.documents.get("pack-goblin");
    expect(store.getById("pack-goblin")?.schemaVersion).toBe(2);
  });

  it("runs the chain ONCE when two readers open the same entry at once", async () => {
    const { manager, store } = makeManager();
    seedEntry(store, "pack-goblin", 0, { name: "Goblin", ac: 12 });
    const counter = { runs: 0 };
    let api!: ServerExtensionAPI;

    manager.registerExtension({
      manifest: packManifest,
      activate: (a) => {
        api = a;
        a.documents.registerMigrations("pack-actor", makeChain(counter));
      },
    });
    await manager.ensureActivated("compendium");

    // The §12 race: two users open the same unmigrated entry. The
    // MigrationLock is keyed by document id, so the second one waits for
    // the first instead of duplicating the work.
    const [a, b] = await Promise.all([
      api.documents.get("pack-goblin"),
      api.documents.get("pack-goblin"),
    ]);
    expect(a?.schemaVersion).toBe(2);
    expect(b?.schemaVersion).toBe(2);
    expect(counter.runs).toBe(1);
  });

  it("does not serialize DIFFERENT entries against each other", async () => {
    const { manager, store } = makeManager();
    seedEntry(store, "pack-goblin", 0, { name: "Goblin", ac: 12 });
    seedEntry(store, "pack-orc", 0, { name: "Orc", ac: 14 });
    let api!: ServerExtensionAPI;

    manager.registerExtension({
      manifest: packManifest,
      activate: (a) => {
        api = a;
        a.documents.registerMigrations("pack-actor", makeChain({ runs: 0 }));
      },
    });
    await manager.ensureActivated("compendium");

    await Promise.all([
      api.documents.get("pack-goblin"),
      api.documents.get("pack-orc"),
    ]);
    expect(store.getById("pack-goblin")?.schemaVersion).toBe(2);
    expect(store.getById("pack-orc")?.schemaVersion).toBe(2);
  });

  it("a broken chain blocks that document only; the read still succeeds", async () => {
    const { manager, store } = makeManager();
    // No `ac` in the v1 system → step 1→2 throws.
    seedEntry(store, "pack-broken", 0, { name: "Broken" });
    seedEntry(store, "pack-ok", 0, { name: "Ok", ac: 12 });
    let api!: ServerExtensionAPI;

    manager.registerExtension({
      manifest: packManifest,
      activate: (a) => {
        api = a;
        a.documents.registerMigrations("pack-actor", makeChain({ runs: 0 }));
      },
    });
    await manager.ensureActivated("compendium");

    const broken = await api.documents.get("pack-broken");
    expect(broken).not.toBeNull();
    expect(broken?.migrationStatus).toBe("blocked");
    expect(broken?.schemaVersion).toBe(1);
    expect(manager.getExtension("compendium")?.state).toBe("Active");

    // Sibling entries of the same type are unaffected.
    expect((await api.documents.get("pack-ok"))?.migrationStatus).toBe("ok");
    expect(store.getById("pack-ok")?.schemaVersion).toBe(2);
  });

  it("migrateIfStale returns null for a missing document and is a no-op for base types", async () => {
    const { manager, store } = makeManager();
    store.save({
      id: "a1",
      type: "Actor",
      name: "Plain",
      system: { hp: 1 },
      flags: {},
      ownership: {},
      schemaVersion: 0,
    });
    expect(await manager.migrateIfStale("nope")).toBeNull();
    const plain = await manager.migrateIfStale("a1");
    expect(plain?.schemaVersion).toBe(0);
    expect(plain?.system).toEqual({ hp: 1 });
  });
});
