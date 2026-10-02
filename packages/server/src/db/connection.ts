import Database, { type Database as DB } from "better-sqlite3";
import { migrate } from "./migrations";

export const CORE_SCHEMA_VERSION = 4;

// single owner of the world SQLite handle. Both DocumentStore and ChatStore
// receive this DB by constructor; neither exposes it. Recreate via openWorldDb() per process.
export function openWorldDb(path: string): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  try {
    migrate(db);
  } catch (err) {
    // don't leak the SQLite handle when migrations reject the schema.
    db.close();
    throw err;
  }
  return db;
}
