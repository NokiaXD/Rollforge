import Database, { type Database as DB } from "better-sqlite3";

export type Role = "GM" | "Player";

export interface UserRecord {
  username: string;
  passwordHash: string;
  role: Role;
  createdAt: number;
}

// Safe subset for the GM panel — never includes passwordHash.
export interface PublicUser {
  username: string;
  role: Role;
  createdAt: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('GM', 'Player')),
  created_at INTEGER NOT NULL
);
`;

interface Row {
  username: string;
  password_hash: string;
  role: Role;
  created_at: number;
}

export class UsersStore {
  private readonly db: DB;
  private userCount = 0;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
    this.userCount = (this.db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c;
  }

  close(): void {
    this.db.close();
  }

  // First registered user auto-becomes GM. Subsequent users default to Player.
  // Caller decides whether a given registration should bootstrap as GM.
  createUser(username: string, passwordHash: string, role: Role): UserRecord {
    const existing = this.db.prepare("SELECT username FROM users WHERE username = ?").get(username);
    if (existing) throw new Error(`user ${username} already exists`);
    const createdAt = Date.now();
    this.db
      .prepare("INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)")
      .run(username, passwordHash, role, createdAt);
    this.userCount += 1;
    return { username, passwordHash, role, createdAt };
  }

  setPasswordHash(username: string, newHash: string): boolean {
    const r = this.db
      .prepare("UPDATE users SET password_hash = ? WHERE username = ?")
      .run(newHash, username);
    return r.changes > 0;
  }

  getByUsername(username: string): UserRecord | null {
    const row = this.db
      .prepare<[string], Row>(
        "SELECT username, password_hash, role, created_at FROM users WHERE username = ?",
      )
      .get(username);
    if (!row) return null;
    return {
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role,
      createdAt: row.created_at,
    };
  }

  isFirstUser(): boolean {
    return this.userCount === 0;
  }

  listUsers(): PublicUser[] {
    const rows = this.db
      .prepare<[], Row>(
        "SELECT username, password_hash, role, created_at FROM users ORDER BY created_at ASC",
      )
      .all();
    return rows.map((r) => ({ username: r.username, role: r.role, createdAt: r.created_at }));
  }

  countByRole(role: Role): number {
    const row = this.db
      .prepare<[Role], { c: number }>("SELECT COUNT(*) as c FROM users WHERE role = ?")
      .get(role);
    return row?.c ?? 0;
  }

  deleteUser(username: string): boolean {
    const r = this.db.prepare("DELETE FROM users WHERE username = ?").run(username);
    if (r.changes > 0) {
      this.userCount -= 1;
      return true;
    }
    return false;
  }
}