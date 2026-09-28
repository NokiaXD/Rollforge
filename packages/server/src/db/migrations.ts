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
    db.prepare(`INSERT OR REPLACE INTO _meta (key, v) VALUES ('coreSchemaVersion', ?)`).run(
      CORE_SCHEMA_VERSION,
    );
  });
  tx(current);
}
