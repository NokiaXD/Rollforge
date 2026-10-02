import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database, { type Database as DB } from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExtensionManager } from "../manager";
import { ChatCommandRegistry } from "../registry";
import { HooksEngine } from "@rollforge/extension-api";
import { DocumentStore } from "../../db/documentStore";
import { migrate } from "../../db/migrations";
import { runDocumentMigrations } from "../../db/migrations-doc";
import * as migrationsBuiltin from "./migrations";
import type { MigrationStep } from "@rollforge/protocol";

let dir: string;
let db: DB;
let store: DocumentStore;
let manager: ExtensionManager;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rollforge-migbuiltin-"));
  db = new Database(join(dir, "w.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  store = new DocumentStore(db);
  manager = new ExtensionManager({
    hooks: new HooksEngine(),
    commandRegistry: new ChatCommandRegistry(),
    activationTimeoutMs: 1000,
    getDocumentStore: () => store,
    getDocumentDb: () => db,
  });
});

afterEach(() => {
  try {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

//  Drives the builtin by giving it a stub api with a captured chat.send.
// We do not use a full ExtensionManager wiring here because we want to
// assert exactly what the handler does — including the GM recovery
// (review) path — without bouncing through the host chat pipeline.
async function invokeBuiltin(args: string[]): Promise<{ sent: string[]; thrown: unknown }> {
  const sent: string[] = [];
  const thrown: unknown[] = [];
  const freshReg = new ChatCommandRegistry();

  const api: any = {
    documents: {
      get: async (id: string) => store.getById(id) ?? null,
    },
    chat: {
      send: async (msg: string) => {
        sent.push(msg);
      },
      registerCommand: (cmd: any) => {
        freshReg.register({
          name: cmd.name,
          description: cmd.description,
          requiredPermission: cmd.requiredPermission ?? "Player",
          extensionId: "core-migrations",
          handler: cmd.handler,
        });
      },
    },
    migrations: {
      listBlocked: async () =>
        db
          .prepare(
            `SELECT doc_id as docId, doc_type as docType, prev_version as prevVersion, created_at as createdAt
             FROM document_migration_snapshots WHERE status = 'failed'
             ORDER BY created_at DESC LIMIT 50`,
          )
          .all() as Array<{
            docId: string;
            docType: string;
            prevVersion: number;
            createdAt: number;
          }>,
      retry: async (id: string) =>
        runOnDoc(id, {}),
      review: async (id: string, patch: { skipSteps: number[]; systemOverride?: unknown }) =>
        runOnDoc(id, {
          skipSteps: new Set(patch.skipSteps),
          ...(patch.systemOverride !== undefined
            ? { systemOverride: patch.systemOverride }
            : {}),
        }),
    },
  };

  async function runOnDoc(
    id: string,
    opts: { skipSteps?: Set<number>; systemOverride?: unknown },
  ) {
    const doc = store.getById(id);
    if (!doc) return { ok: false as const, atFrom: 0, atTo: 0, error: `Document ${id} not found` };
    const reg = manager.migrationRegistry.get(doc.type);
    if (!reg) {
      return {
        ok: false as const,
        atFrom: doc.schemaVersion,
        atTo: doc.schemaVersion,
        error: `No migration chain registered for documentType "${doc.type}"`,
      };
    }
    let result: any;
    await manager.migrationLock.runExclusive(doc.type, async () => {
      result = await runDocumentMigrations(db, doc, reg.chain as any, reg.targetVersion, opts);
    });
    if (!result) return { ok: false as const, atFrom: 0, atTo: 0, error: "lock failed" };
    if (result.ok) return { ok: true as const, fromVersion: result.fromVersion, toVersion: result.toVersion };
    return { ok: false as const, atFrom: result.atFrom, atTo: result.atTo, error: result.error.message };
  }

  migrationsBuiltin.activate(api);
  const cmd = freshReg.get("migrations");
  if (!cmd) throw new Error("migrations command not registered");

  try {
    await cmd.handler({ args, rest: args.join(" ") }, { userId: "u1", isGM: true });
  } catch (e) {
    thrown.push(e);
  }
  return { sent, thrown: thrown[0] };
}

describe("core-migrations builtin", () => {
  it("list with no args reports empty when no snapshots exist", async () => {
    const { sent } = await invokeBuiltin(["list"]);
    expect(sent).toEqual(["No blocked documents."]);
  });

  it("list shows blocked docs from the snapshot table", async () => {
    store.save({
      id: "d-blocked",
      type: "cpr-character",
      name: "x",
      system: {},
      flags: {},
      ownership: { default: "LIMITED" },
      schemaVersion: 1,
      migrationStatus: "blocked",
    });
    db.prepare(
      `INSERT INTO document_migration_snapshots
        (doc_id, doc_type, prev_version, new_version, status, snapshot_json, created_at)
        VALUES (?, ?, ?, ?, 'failed', '{}', ?)`,
    ).run("d-blocked", "cpr-character", 1, 1, Date.now());

    const { sent } = await invokeBuiltin(["list"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Blocked documents:");
    expect(sent[0]).toContain("d-blocked");
  });

  it("retry re-runs the registered chain and clears the blocked status", async () => {
    store.save({
      id: "d-recover",
      type: "cpr-character",
      name: "x",
      system: { hp: 1 },
      flags: {},
      ownership: { default: "LIMITED" },
      schemaVersion: 1,
      migrationStatus: "blocked",
    });
    const chain: MigrationStep<any>[] = [
      { from: 1, to: 2, up: (s) => ({ ...s, hp: s.hp + 5 }) },
    ];
    manager.migrationRegistry.register("cpr-character", chain, 2, "test-ext");

    const { sent } = await invokeBuiltin(["retry", "d-recover"]);
    expect(sent).toContain("Document d-recover migrated to v2.");

    const refetched = store.getById("d-recover");
    expect(refetched?.schemaVersion).toBe(2);
    expect(refetched?.migrationStatus).toBe("ok");
    expect((refetched?.system as any).hp).toBe(6);
  });

  it("retry on missing doc prints a friendly message", async () => {
    const { sent } = await invokeBuiltin(["retry", "nope"]);
    expect(sent).toEqual(["Document nope not found."]);
  });

  it("review applies GM patch: skipSteps + systemOverride", async () => {
    store.save({
      id: "d-patch",
      type: "cpr-character",
      name: "x",
      system: { hp: 1 },
      flags: {},
      ownership: { default: "LIMITED" },
      schemaVersion: 1,
      migrationStatus: "blocked",
    });
    const chain: MigrationStep<any>[] = [
      // step 1->2 is broken in the live chain; review skips it
      { from: 1, to: 2, up: () => { throw new Error("original bug"); } },
      // step 2->3 is fine
      { from: 2, to: 3, up: (s) => ({ ...s, hp: s.hp * 10 }) },
    ];
    manager.migrationRegistry.register("cpr-character", chain, 3, "test-ext");

    const { sent } = await invokeBuiltin([
      "review",
      "d-patch",
      "1",
      JSON.stringify({ hp: 7 }),
    ]);

    expect(sent[0]).toContain("Document d-patch patched and migrated to v3.");
    const refetched = store.getById("d-patch");
    expect(refetched?.schemaVersion).toBe(3);
    expect(refetched?.migrationStatus).toBe("ok");
    expect((refetched?.system as any).hp).toBe(70);
  });

  it("review with malformed JSON throws not-a-command", async () => {
    const { thrown } = await invokeBuiltin(["review", "x", "1", "not-json{"]);
    expect((thrown as Error).message).toBe("not-a-command");
  });

  it("review with wrong arity throws not-a-command", async () => {
    const { thrown } = await invokeBuiltin(["review", "x"]);
    expect((thrown as Error).message).toBe("not-a-command");
  });

  it("retry with wrong arity throws not-a-command", async () => {
    const { thrown } = await invokeBuiltin(["retry"]);
    expect((thrown as Error).message).toBe("not-a-command");
  });

  it("rejects unknown subcommand with not-a-command", async () => {
    const { thrown } = await invokeBuiltin(["bogus"]);
    expect((thrown as Error).message).toBe("not-a-command");
  });
});