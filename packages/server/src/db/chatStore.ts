import type { Database as DB } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { ChatMessageEvent, DiceResult, DiceRoll, RollActor } from "@rollforge/protocol";

interface ChatRow {
  seq: number;
  id: string;
  user_id: string;
  username: string;
  role: "GM" | "Player";
  kind: "chat" | "roll";
  text: string;
  rolls_json: string | null;
  result_json: string | null;
  actor_type: "user" | "character" | null;
  actor_id: string | null;
  actor_name: string | null;
  whisper_to: string | null;
  created_at: number;
}

export interface RecentOptions {
  beforeSeq?: number;
  forUser?: {
    userId: string;
    username?: string;
  };
}

interface InsertChatEvent {
  userId: string;
  username: string;
  role: "GM" | "Player";
  kind: "chat" | "roll";
  text: string;
  rolls?: DiceRoll[];
  result?: DiceResult;
  actor?: RollActor;
  whisperTo?: string;
  createdAt: number;
}

// append-only chat history. Recent(limit) is the hot path; pagination by seq is for later.
// lastSeq() exists so the connect handler can stamp dedupe-stamps on the client if it ever needs to.
export class ChatStore {
  // Shared better-sqlite3 handle from openWorldDb. Never exposed to consumers.
  private readonly db: DB;

  constructor(db: DB) {
    this.db = db;
  }

  // the underlying DB handle is owned by db/connection.ts and torn down by
  // createRollforgeServer. close() is a no-op so tests can call store.close() uniformly.
  close(): void {
    // intentionally empty
  }

  // Persists and returns the event with server-assigned seq + id. Each kind carries its own JSON columns;
  // actor snapshot is split into type/id/name columns so historical rolls don't read against the live table.
  append(ev: InsertChatEvent): ChatMessageEvent {
    const id = randomUUID();
    const tx = this.db.transaction((input: InsertChatEvent) => {
      const stmt = this.db.prepare(
        `INSERT INTO chat_messages
           (id, user_id, username, role, kind, text, rolls_json, result_json,
            actor_type, actor_id, actor_name, whisper_to, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const info = stmt.run(
        id,
        input.userId,
        input.username,
        input.role,
        input.kind,
        input.text,
        input.kind === "roll" ? JSON.stringify(input.rolls ?? []) : null,
        input.kind === "roll" ? JSON.stringify(input.result ?? null) : null,
        input.actor?.type ?? null,
        input.actor?.type === "character"
          ? input.actor.characterId
          : input.actor?.type === "user"
            ? input.actor.userId
            : null,
        input.actor?.name ?? null,
        input.whisperTo ?? null,
        input.createdAt,
      );
      return Number(info.lastInsertRowid);
    });
    const seq = tx(ev);
    const out: ChatMessageEvent = {
      type: "ChatMessage",
      seq,
      id,
      userId: ev.userId,
      username: ev.username,
      role: ev.role,
      kind: ev.kind,
      text: ev.text,
      createdAt: ev.createdAt,
    };
    if (ev.kind === "roll") {
      if (ev.rolls) out.rolls = ev.rolls;
      if (ev.result) out.result = ev.result;
    }
    if (ev.actor) out.actor = ev.actor;
    if (ev.whisperTo) out.whisperTo = ev.whisperTo;
    return out;
  }

  // Returns the last `limit` messages in ascending seq order. If `beforeSeq` is provided,
  // only messages with seq < beforeSeq are returned (for pagination).
  // If `forUser` is provided, whispers are scoped so that only the sender and recipient can see them.
  recent(limit: number, beforeSeqOrOpts?: number | RecentOptions, maybeOpts?: RecentOptions): ChatMessageEvent[] {
    const cap = Math.max(0, Math.min(limit, 1000));
    let beforeSeq: number | undefined;
    let opts: RecentOptions | undefined;

    if (typeof beforeSeqOrOpts === "number") {
      beforeSeq = beforeSeqOrOpts;
      opts = maybeOpts;
    } else if (beforeSeqOrOpts && typeof beforeSeqOrOpts === "object") {
      beforeSeq = beforeSeqOrOpts.beforeSeq;
      opts = beforeSeqOrOpts;
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (beforeSeq !== undefined) {
      conditions.push("seq < ?");
      params.push(beforeSeq);
    }

    if (opts?.forUser) {
      const { userId, username } = opts.forUser;
      if (username) {
        conditions.push("(whisper_to IS NULL OR user_id = ? OR whisper_to = ? OR whisper_to = ?)");
        params.push(userId, userId, username);
      } else {
        conditions.push("(whisper_to IS NULL OR user_id = ? OR whisper_to = ?)");
        params.push(userId, userId);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `
      SELECT seq, id, user_id, username, role, kind, text, rolls_json, result_json,
             actor_type, actor_id, actor_name, whisper_to, created_at
        FROM chat_messages
       ${whereClause}
       ORDER BY seq DESC
       LIMIT ?
    `;
    params.push(cap);

    const rows = this.db.prepare(sql).all(...params) as ChatRow[];
    return rows.reverse().map(this.toEvent);
  }

  private toEvent = (row: ChatRow): ChatMessageEvent => {
    const ev: ChatMessageEvent = {
      type: "ChatMessage",
      seq: row.seq,
      id: row.id,
      userId: row.user_id,
      username: row.username,
      role: row.role,
      kind: row.kind,
      text: row.text,
      createdAt: row.created_at,
    };
    if (row.whisper_to) {
      ev.whisperTo = row.whisper_to;
    }
    if (row.kind === "roll") {
      try {
        if (row.rolls_json) ev.rolls = JSON.parse(row.rolls_json) as DiceRoll[];
      } catch {
        // malformed row skipped — schema guard should have prevented this.
      }
      try {
        if (row.result_json) ev.result = JSON.parse(row.result_json) as DiceResult;
      } catch {
        // ditto
      }
    }
    if (row.actor_type === "user" && row.actor_id && row.actor_name) {
      ev.actor = { type: "user", userId: row.actor_id, name: row.actor_name };
    } else if (row.actor_type === "character" && row.actor_id && row.actor_name) {
      ev.actor = { type: "character", characterId: row.actor_id, name: row.actor_name };
    }
    return ev;
  };
}
