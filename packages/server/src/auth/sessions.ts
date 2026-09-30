import Database, { type Database as DB } from "better-sqlite3";
import { randomBytes } from "node:crypto";
import type { Role, UsersStore } from "./usersStore";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;

export { SESSION_TTL_MS };

interface Row {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

// Opaque session ids: 256 bits from randomBytes, so the cookie carries no
// claims and revoking is just DELETE. The role is NOT stored here — callers
// resolve it live from UsersStore so a promotion/demotion applies immediately.
export class SessionsStore {
  private readonly db: DB;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  create(userId: string, ttlMs: number = SESSION_TTL_MS): SessionRecord {
    const now = Date.now();
    // Opportunistic sweep: expired rows are already dead on read, this just
    // keeps the table small without needing a timer.
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    const id = randomBytes(32).toString("base64url");
    const expiresAt = now + ttlMs;
    this.db
      .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(id, userId, now, expiresAt);
    return { id, userId, createdAt: now, expiresAt };
  }

  get(id: string): SessionRecord | null {
    const row = this.db
      .prepare<[string], Row>("SELECT id, user_id, created_at, expires_at FROM sessions WHERE id = ?")
      .get(id);
    if (!row) return null;
    if (row.expires_at <= Date.now()) {
      this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
      return null;
    }
    return { id: row.id, userId: row.user_id, createdAt: row.created_at, expiresAt: row.expires_at };
  }

  delete(id: string): boolean {
    return this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id).changes > 0;
  }

  deleteAllFor(userId: string): number {
    return this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId).changes;
  }
}

export interface SessionPayload {
  sub: string;
  role: Role;
}

export const SESSION_COOKIE = "rf_session";

/**
 * Single lookup path for both the HTTP middleware and the socket handshake:
 * cookie value -> session row -> user row. Returns null for unknown, expired
 * or dangling (user deleted) sessions.
 */
export function resolveSession(
  sessions: SessionsStore,
  users: UsersStore,
  cookieValue: string | undefined
): SessionPayload | null {
  if (!cookieValue) return null;
  const session = sessions.get(cookieValue);
  if (!session) return null;
  const user = users.getByUsername(session.userId);
  if (!user) {
    sessions.delete(session.id);
    return null;
  }
  return { sub: user.username, role: user.role };
}
