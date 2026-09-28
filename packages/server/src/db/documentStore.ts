import type { Database as DB } from "better-sqlite3";
import type { Document } from "@rollforge/protocol";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
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
  updated_at: number;
}

export class DocumentStore {
  // shared handle from openWorldDb. Never exposed to consumers.
  private readonly db: DB;

  constructor(db: DB) {
    this.db = db;
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  getById<T = unknown>(id: string): Document<T> | null {
    const row = this.db
      .prepare<[string], Row>("SELECT id, type, name, data, rev, updated_at FROM documents WHERE id = ?")
      .get(id);
    return row ? this.toDoc<T>(row) : null;
  }

  getByType<T = unknown>(type: string): Document<T>[] {
    const rows = this.db
      .prepare<[string], Row>(
        "SELECT id, type, name, data, rev, updated_at FROM documents WHERE type = ? ORDER BY id",
      )
      .all(type);
    return rows.map((r) => this.toDoc<T>(r));
  }

  save<TSystem>(doc: Omit<Document<TSystem>, "_rev">): Document<TSystem> {
    const tx = this.db.transaction((input: Omit<Document<TSystem>, "_rev">) => {
      const existing = this.db.prepare("SELECT id FROM documents WHERE id = ?").get(input.id);
      if (existing) throw new Error(`document ${input.id} already exists; use update()`);
      const now = Date.now();
      const rest = this.serializeRest(input);
      this.db
        .prepare(
          "INSERT INTO documents (id, type, name, data, rev, updated_at) VALUES (?, ?, ?, ?, 0, ?)",
        )
        .run(input.id, input.type, input.name, JSON.stringify(rest), now);
      return { ...input, _rev: 0 };
    });
    return tx(doc);
  }

  update<TSystem>(doc: Document<TSystem>, expectedRev: number): Document<TSystem> {
    const tx = this.db.transaction((input: Document<TSystem>, rev: number) => {
      const row = this.db
        .prepare<[string], Row>(
          "SELECT id, type, name, data, rev, updated_at FROM documents WHERE id = ?",
        )
        .get(input.id);
      if (!row) throw new Error(`document ${input.id} not found`);
      if (row.rev !== rev) throw new Error(`stale _rev: expected ${rev}, got ${row.rev}`);
      const newRev = row.rev + 1;
      const now = Date.now();
      const rest = this.serializeRest(input);
      this.db
        .prepare(
          "UPDATE documents SET type = ?, name = ?, data = ?, rev = ?, updated_at = ? WHERE id = ?",
        )
        .run(input.type, input.name, JSON.stringify(rest), newRev, now, input.id);
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
    const out: Document<T> = {
      id: row.id,
      type: row.type,
      name: row.name,
      system: data.system,
      flags: data.flags,
      ownership: data.ownership,
      _rev: row.rev,
    };
    if (data.img !== undefined) out.img = data.img;
    return out;
  }
}
