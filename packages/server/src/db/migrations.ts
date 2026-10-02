import type { Database as DB } from "better-sqlite3";
import { CORE_SCHEMA_VERSION } from "./connection";

interface MetaRow {
  v: number;
}

export function migrate(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, v INTEGER NOT NULL);`);
  const row = db.prepare<[], MetaRow>(`SELECT v FROM _meta WHERE key='coreSchemaVersion'`).get();
  const current = row?.v ?? 0;

  if (current > CORE_SCHEMA_VERSION) {
    throw new Error(
      `world-schema-newer: db is at v${current}, server expects v${CORE_SCHEMA_VERSION} or below`,
    );
  }

  const tx = db.transaction((from: number) => {
    if (from < 1) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chat_messages (
          seq         INTEGER PRIMARY KEY AUTOINCREMENT,
          id          TEXT    NOT NULL,
          user_id     TEXT    NOT NULL,
          username    TEXT    NOT NULL,
          role        TEXT    NOT NULL,
          kind        TEXT    NOT NULL CHECK (kind IN ('chat','roll')),
          text        TEXT    NOT NULL,
          rolls_json  TEXT,
          result_json TEXT,
          created_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chat_seq ON chat_messages(seq);
      `);
    }
    if (from < 2) {
      db.exec(`
        ALTER TABLE chat_messages ADD COLUMN actor_type TEXT;
        ALTER TABLE chat_messages ADD COLUMN actor_id TEXT;
        ALTER TABLE chat_messages ADD COLUMN actor_name TEXT;
      `);
    }
    if (from < 3) {
      db.exec(`
        ALTER TABLE chat_messages ADD COLUMN whisper_to TEXT;
      `);
    }
    if (from < 4) {
      // Paso 15: per-document schemaVersion + migration gate state. Default 0
      // matches the registry's missing-version contract — legacy rows and
      // never-migrated types both read as v0 until a migration runs.
      // The documents table itself is created here at v4; DocumentStore's
      // own CREATE TABLE IF NOT EXISTS is a no-op for fresh DBs and a
      // safety net for the test path that opens DBs without the migration
      // runner (we never actually do that anymore, but the dual create is
      // harmless and keeps the store usable in isolation).
      db.exec(`
        CREATE TABLE IF NOT EXISTS documents (
          id              TEXT    PRIMARY KEY,
          type            TEXT    NOT NULL,
          name            TEXT    NOT NULL,
          data            TEXT    NOT NULL,
          rev             INTEGER NOT NULL DEFAULT 0,
          schema_version  INTEGER NOT NULL DEFAULT 0,
          migration_status TEXT   NOT NULL DEFAULT 'ok',
          updated_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
        CREATE TABLE IF NOT EXISTS document_migration_snapshots (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          doc_id        TEXT    NOT NULL,
          doc_type      TEXT    NOT NULL,
          prev_version  INTEGER NOT NULL,
          new_version   INTEGER NOT NULL,
          status        TEXT    NOT NULL CHECK (status IN ('ok','failed')),
          snapshot_json TEXT    NOT NULL,
          created_at    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mig_snap_doc ON document_migration_snapshots(doc_id);
      `);
    }
    db.prepare(`INSERT OR REPLACE INTO _meta (key, v) VALUES ('coreSchemaVersion', ?)`).run(
      CORE_SCHEMA_VERSION,
    );
  });
  tx(current);
}
