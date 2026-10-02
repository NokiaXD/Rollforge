import type { Database as DB } from "better-sqlite3";
import type { Document, MigrationChain } from "@rollforge/protocol";

//  pure SQL — one transaction per step, snapshot written once
// before the failed step. Failed steps mark the document blocked and
// leave it at the schemaVersion of the failing step so a future re-attempt
// picks up where we left off (skipSteps + systemOverride come from the GM
// review path, see builtin migrations.ts).
export interface RunMigrationsOpts {
  skipSteps?: Set<number>;
  systemOverride?: unknown;
  skipSnapshot?: boolean;
}

export type RunMigrationsResult =
  | { ok: true; fromVersion: number; toVersion: number }
  | { ok: false; blocked: true; atFrom: number; atTo: number; error: Error };

export async function runDocumentMigrations<TSystem>(
  db: DB,
  doc: Document<TSystem>,
  chain: MigrationChain<TSystem>,
  targetVersion: number,
  opts: RunMigrationsOpts = {},
): Promise<RunMigrationsResult> {
  if (doc.schemaVersion >= targetVersion) {
    return { ok: true, fromVersion: doc.schemaVersion, toVersion: doc.schemaVersion };
  }

  let currentSystem: unknown = opts.systemOverride ?? doc.system;
  let currentVersion = doc.schemaVersion;
  const startVersion = currentVersion;

  for (const step of chain) {
    if (currentVersion >= targetVersion) break;
    if (currentVersion !== step.from) continue;

    if (opts.skipSteps?.has(step.from)) {
      currentVersion = step.to;
      continue;
    }

    try {
      const next = await step.up(currentSystem as TSystem);
      const rest = {
        system: next,
        flags: doc.flags,
        ownership: doc.ownership,
        ...(doc.img !== undefined ? { img: doc.img } : {}),
      };
      db.prepare(
        "UPDATE documents SET data = ?, schema_version = ? WHERE id = ?",
      ).run(JSON.stringify(rest), step.to, doc.id);
      currentSystem = next;
      currentVersion = step.to;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      try {
        const writeSnap = db.transaction(() => {
          if (!opts.skipSnapshot) {
            db.prepare(
              `INSERT INTO document_migration_snapshots
                (doc_id, doc_type, prev_version, new_version, status, snapshot_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ).run(
              doc.id,
              doc.type,
              step.from,
              step.from,
              "failed",
              JSON.stringify({
                system: doc.system,
                flags: doc.flags,
                ownership: doc.ownership,
                ...(doc.img !== undefined ? { img: doc.img } : {}),
              }),
              Date.now(),
            );
          }
          db.prepare(
            "UPDATE documents SET migration_status = 'blocked' WHERE id = ?",
          ).run(doc.id);
        });
        writeSnap();
      } catch (writeErr) {
        console.error(`[migrations] failed to record blocked state for ${doc.id}:`, writeErr);
      }
      return { ok: false, blocked: true, atFrom: step.from, atTo: step.to, error };
    }
  }

  if (currentVersion >= targetVersion) {
    db.prepare("UPDATE documents SET migration_status = 'ok' WHERE id = ?").run(doc.id);
    return { ok: true, fromVersion: startVersion, toVersion: currentVersion };
  }

  return {
    ok: false,
    blocked: true,
    atFrom: currentVersion,
    atTo: currentVersion,
    error: new Error(
      `chain does not reach targetVersion=${targetVersion}; stopped at ${currentVersion}`,
    ),
  };
}