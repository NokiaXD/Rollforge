import type { Database as DB } from "better-sqlite3";
import type { Document } from "@rollforge/protocol";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL DEFAULT 0,
  migration_status TEXT NOT NULL DEFAULT 'ok',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
`;

interface Row {
  id: string;
  type: string;
  name: string;
  data: string;
  rev: number;
  schema_version: number;
  migration_status: "ok" | "blocked";
  updated_at: number;
}

// schemaVersion and migrationStatus are optional on the create path so
// callers don't need to thread them through every save(); they're always
// present on the read path (Document shape). The runner resolves a default
// for new docs via opts.getCurrentSchemaVersion, else 0 — true legacy rows
// pre-column also land at 0 because of the SQLite DEFAULT clause.
export interface DocumentStoreOpts {
  getCurrentSchemaVersion?: (type: string) => number | undefined;
}

export type DocumentInput<TSystem = Record<string, unknown>> =
  Omit<Document<TSystem>, "_rev" | "schemaVersion" | "migrationStatus"> & {
    schemaVersion?: number;
    migrationStatus?: Document["migrationStatus"];
  };

export class DocumentStore {
  private readonly db: DB;
  private getCurrentSchemaVersion: (type: string) => number | undefined;

  constructor(db: DB, opts: DocumentStoreOpts = {}) {
    this.db = db;
    this.getCurrentSchemaVersion = opts.getCurrentSchemaVersion ?? (() => undefined);
    this.db.exec(SCHEMA);
  }

  //  The ExtensionManager is built AFTER the store in both construction
  //  paths (server.ts builds its own at :85; main.ts hands one in), and it
  //  owns the only source of truth for a type's current schemaVersion
  //  (§12: the number the extension declares in contributes.documentTypes).
  //  A constructor arg can't reach it, so the host injects the resolver
  //  once the manager exists. Without it every contributed type's documents
  //  were born at 0 and walked the whole chain on first write.
  setSchemaVersionResolver(fn: (type: string) => number | undefined): void {
    this.getCurrentSchemaVersion = fn;
  }

  close(): void {
    this.db.close();
  }

  getById<T = unknown>(id: string): Document<T> | null {
    const row = this.db
      .prepare<[string], Row>(
        "SELECT id, type, name, data, rev, schema_version, migration_status, updated_at FROM documents WHERE id = ?",
      )
      .get(id);
    return row ? this.toDoc<T>(row) : null;
  }

  getByType<T = unknown>(type: string): Document<T>[] {
    const rows = this.db
      .prepare<[string], Row>(
        "SELECT id, type, name, data, rev, schema_version, migration_status, updated_at FROM documents WHERE type = ? ORDER BY id",
      )
      .all(type);
    return rows.map((r) => this.toDoc<T>(r));
  }

  save<TSystem>(doc: DocumentInput<TSystem>): Document<TSystem> {
    const tx = this.db.transaction((input: DocumentInput<TSystem>) => {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.id)) {
        throw new Error(
          `invalid document id "${input.id}": must match [a-zA-Z0-9_-]{1,128}`,
        );
      }
      const existing = this.db.prepare("SELECT id FROM documents WHERE id = ?").get(input.id);
      if (existing) throw new Error(`document ${input.id} already exists; use update()`);
      const schemaVersion =
        input.schemaVersion ?? this.getCurrentSchemaVersion(input.type) ?? 0;
      const migrationStatus = input.migrationStatus ?? "ok";
      const now = Date.now();
      const rest = this.serializeRest(input);
      this.db
        .prepare(
          "INSERT INTO documents (id, type, name, data, rev, schema_version, migration_status, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)",
        )
        .run(
          input.id,
          input.type,
          input.name,
          JSON.stringify(rest),
          schemaVersion,
          migrationStatus,
          now,
        );
      return { ...input, schemaVersion, migrationStatus, _rev: 0 };
    });
    return tx(doc);
  }

  update<TSystem>(doc: Document<TSystem>, expectedRev: number): Document<TSystem> {
    const tx = this.db.transaction((input: Document<TSystem>, rev: number) => {
      const row = this.db
        .prepare<[string], Row>(
          "SELECT id, type, name, rev, schema_version, migration_status, data, updated_at FROM documents WHERE id = ?",
        )
        .get(input.id);
      if (!row) throw new Error(`document ${input.id} not found`);
      if (row.rev !== rev) throw new Error(`stale _rev: expected ${rev}, got ${row.rev}`);
      const newRev = row.rev + 1;
      const now = Date.now();
      const rest = this.serializeRest(input);
      this.db
        .prepare(
          "UPDATE documents SET type = ?, name = ?, data = ?, rev = ?, schema_version = ?, migration_status = ?, updated_at = ? WHERE id = ?",
        )
        .run(
          input.type,
          input.name,
          JSON.stringify(rest),
          newRev,
          input.schemaVersion,
          input.migrationStatus,
          now,
          input.id,
        );
      return { ...input, _rev: newRev };
    });
    return tx(doc, expectedRev);
  }

  delete(id: string): boolean {
    const r = this.db.prepare("DELETE FROM documents WHERE id = ?").run(id);
    return r.changes > 0;
  }

  private serializeRest(doc: {
    system: unknown;
    flags: unknown;
    ownership: unknown;
    img?: string;
  }): Record<string, unknown> {
    const out: Record<string, unknown> = {
      system: doc.system,
      flags: doc.flags,
      ownership: doc.ownership,
    };
    if (doc.img !== undefined) out.img = doc.img;
    return out;
  }

  private toDoc<T>(row: Row): Document<T> {
    const data = JSON.parse(row.data) as {
      system: T;
      flags: Record<string, Record<string, unknown>>;
      ownership: Document<T>["ownership"];
      img?: string;
    };
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      system: data.system,
      flags: data.flags,
      ownership: data.ownership,
      ...(data.img !== undefined ? { img: data.img } : {}),
      schemaVersion: row.schema_version,
      migrationStatus: row.migration_status,
      _rev: row.rev,
    };
  }
}