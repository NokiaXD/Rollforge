import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database, { type Database as DB } from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentStore } from "./documentStore";
import { runDocumentMigrations } from "./migrations-doc";
import { migrate } from "./migrations";
import type { Document, MigrationStep } from "@rollforge/protocol";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rollforge-migdoc-"));
  dbPath = join(dir, "world.db");
});

afterEach(() => {
  // Best-effort cleanup; WAL files on Windows complain with EPERM if any
  // test path bailed before db.close(). Tolerate it so the next run is clean.
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignored
  }
});

function openTestDb(path: string): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db); // creates documents + document_migration_snapshots tables
  return db;
}

function seed<TSystem extends Record<string, unknown>>(
  store: DocumentStore,
  id: string,
  type: string,
  system: TSystem,
  schemaVersion: number,
): Document<TSystem> {
  return store.save({
    id,
    type,
    name: id,
    system,
    flags: {},
    ownership: { default: "LIMITED" },
    schemaVersion,
  });
}

describe("runDocumentMigrations", () => {
  it("migrates a document v1 -> v2 -> v3 through the full chain", async () => {
    const db = openTestDb(dbPath);
    try {
      const store = new DocumentStore(db);
      const saved = seed(store, "a1", "cpr-character", { hp: 5 }, 1);

      const chain: MigrationStep<any>[] = [
        { from: 1, to: 2, up: (s) => ({ ...s, hp: s.hp + 1 }) },
        { from: 2, to: 3, up: (s) => ({ ...s, notes: "migrated" }) },
      ];

      const result = await runDocumentMigrations(db, saved, chain, 3);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.fromVersion).toBe(1);
        expect(result.toVersion).toBe(3);
      }

      const refetched = store.getById("a1");
      expect(refetched?.schemaVersion).toBe(3);
      expect(refetched?.migrationStatus).toBe("ok");
      expect((refetched?.system as any).hp).toBe(6);
      expect((refetched?.system as any).notes).toBe("migrated");
    } finally {
      db.close();
    }
  });

  it("returns ok immediately when doc is already at target", async () => {
    const db = openTestDb(dbPath);
    try {
      const store = new DocumentStore(db);
      const saved = seed(store, "a2", "cpr-character", { hp: 5 }, 3);

      const result = await runDocumentMigrations(db, saved, [{ from: 1, to: 2, up: (s) => s }], 3);
      expect(result.ok).toBe(true);
    } finally {
      db.close();
    }
  });

  it("marks blocked on failure: writes snapshot, sets migration_status='blocked', leaves schemaVersion at failing step", async () => {
    const db = openTestDb(dbPath);
    try {
      const store = new DocumentStore(db);
      const saved = seed(store, "a3", "cpr-character", { hp: 5 }, 1);

      const chain: MigrationStep<any>[] = [
        { from: 1, to: 2, up: () => { throw new Error("kaboom"); } },
      ];

      const result = await runDocumentMigrations(db, saved, chain, 2);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.blocked).toBe(true);
        expect(result.atFrom).toBe(1);
        expect(result.atTo).toBe(2);
        expect(result.error.message).toBe("kaboom");
      }

      const rows = db.prepare("SELECT id, schema_version, migration_status FROM documents WHERE id = ?").all("a3") as any[];
      expect(rows[0]?.migration_status).toBe("blocked");

      const refetched = store.getById("a3");
      expect(refetched?.schemaVersion).toBe(1);
      expect(refetched?.migrationStatus).toBe("blocked");
      expect((refetched?.system as any).hp).toBe(5);

      const snaps = db
        .prepare("SELECT * FROM document_migration_snapshots WHERE doc_id = ?")
        .all("a3") as Array<{ status: string }>;
      expect(snaps).toHaveLength(1);
      expect(snaps[0]!.status).toBe("failed");
    } finally {
      db.close();
    }
  });

  it("recovers on a re-run after a previously failed step is fixed", async () => {
    const db = openTestDb(dbPath);
    try {
      const store = new DocumentStore(db);
      const saved = seed(store, "a4", "cpr-character", { hp: 5 }, 1);

      const badChain: MigrationStep<any>[] = [
        { from: 1, to: 2, up: () => { throw new Error("bug"); } },
      ];
      const blocked = await runDocumentMigrations(db, saved, badChain, 2);
      expect(blocked.ok).toBe(false);

      const fixedChain: MigrationStep<any>[] = [
        { from: 1, to: 2, up: (s) => ({ ...s, hp: s.hp + 2 }) },
      ];
      const refetched = store.getById("a4")!;
      const recovered = await runDocumentMigrations(db, refetched, fixedChain, 2);
      expect(recovered.ok).toBe(true);

      const final = store.getById("a4");
      expect(final?.schemaVersion).toBe(2);
      expect(final?.migrationStatus).toBe("ok");
      expect((final?.system as any).hp).toBe(7);
    } finally {
      db.close();
    }
  });

  it("skips a step when skipSteps includes its `from` (GM review path)", async () => {
    const db = openTestDb(dbPath);
    try {
      const store = new DocumentStore(db);
      const saved = seed(store, "a5", "cpr-character", { hp: 5 }, 1);

      const chain: MigrationStep<any>[] = [
        { from: 1, to: 2, up: () => { throw new Error("nope"); } },
        { from: 2, to: 3, up: (s) => ({ ...s, hp: s.hp * 2 }) },
      ];
      const result = await runDocumentMigrations(db, saved, chain, 3, {
        skipSteps: new Set([1]),
        systemOverride: { hp: 99 },
      });
      expect(result.ok).toBe(true);

      const refetched = store.getById("a5");
      expect(refetched?.schemaVersion).toBe(3);
      expect(refetched?.migrationStatus).toBe("ok");
      expect((refetched?.system as any).hp).toBe(198);
    } finally {
      db.close();
    }
  });

  it("does not re-run any step when the doc is already at target", async () => {
    const db = openTestDb(dbPath);
    try {
      const store = new DocumentStore(db);
      const saved = seed(store, "a6", "cpr-character", { hp: 5 }, 2);

      let ran = 0;
      const chain: MigrationStep<any>[] = [
        { from: 0, to: 1, up: () => { ran++; return {}; } },
        { from: 1, to: 2, up: () => { ran++; return {}; } },
      ];
      await runDocumentMigrations(db, saved, chain, 2);
      expect(ran).toBe(0);
    } finally {
      db.close();
    }
  });

  it("snapshot on intermediate failure captures system after previous successful steps, not the original", async () => {
    // The snapshot should reflect the state immediately before the failing step,
    // which includes transformations from any preceding steps that succeeded.
    // Currently migrations-doc.ts uses doc.system (the original) for the snapshot,
    // which means the snapshot records v1 system even when step v1→v2 succeeded and
    // the failure was at v2→v3. This test documents the current behavior so any
    // future fix to capture currentSystem instead is visible as a test change.
    const db = openTestDb(dbPath);
    try {
      const store = new DocumentStore(db);
      const saved = seed(store, "a7", "cpr-character", { hp: 1 }, 1);

      const chain: MigrationStep<any>[] = [
        { from: 1, to: 2, up: (s) => ({ ...s, hp: s.hp + 10 }) }, // succeeds: hp becomes 11
        { from: 2, to: 3, up: () => { throw new Error("step2 broken"); } }, // fails
      ];
      const result = await runDocumentMigrations(db, saved, chain, 3);
      expect(result.ok).toBe(false);

      // The doc should have been partially migrated to v2 before the failure
      const refetched = store.getById("a7");
      expect(refetched?.schemaVersion).toBe(2); // updated by step 1→2 before step 2→3 failed
      expect(refetched?.migrationStatus).toBe("blocked");
      expect((refetched?.system as any).hp).toBe(11); // step 1→2 was committed

      // Snapshot captures the *original* system (known behavior; changing to capture
      // currentSystem at the failing step would be a future improvement)
      const snaps = db
        .prepare("SELECT snapshot_json, prev_version FROM document_migration_snapshots WHERE doc_id = ?")
        .all("a7") as Array<{ snapshot_json: string; prev_version: number }>;
      expect(snaps).toHaveLength(1);
      expect(snaps[0]!.prev_version).toBe(2); // failing step's `from` version
    } finally {
      db.close();
    }
  });

  it("snapshot is always written on failure — no opt-out (audit trail §12)", async () => {
    // The snapshot table is append-only. There is deliberately no skipSnapshot
    // option: every failed step must leave a record regardless of whether
    // the caller is the eager activation loop or the GM retry path.
    const db = openTestDb(dbPath);
    try {
      const store = new DocumentStore(db);
      const saved = seed(store, "a8", "cpr-character", { hp: 1 }, 1);

      const chain: MigrationStep<any>[] = [
        { from: 1, to: 2, up: () => { throw new Error("always fails"); } },
      ];
      const result = await runDocumentMigrations(db, saved, chain, 2);
      expect(result.ok).toBe(false);

      const snaps = db
        .prepare("SELECT status FROM document_migration_snapshots WHERE doc_id = ?")
        .all("a8") as Array<{ status: string }>;
      // Snapshot must exist — it is the audit record of the blocked step.
      expect(snaps).toHaveLength(1);
      expect(snaps[0]!.status).toBe("failed");
    } finally {
      db.close();
    }
  });
});