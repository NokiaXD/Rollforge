import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorldDb, CORE_SCHEMA_VERSION } from "./connection";
import { ChatStore } from "./chatStore";
import type { Database as DB } from "better-sqlite3";
import type { ChatMessageEvent, DiceResult, DiceRoll, RollActor } from "@rollforge/protocol";

let dir: string;
let dbPath: string;
let opened: DB[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rollforge-chat-"));
  dbPath = join(dir, "world.db");
  opened = [];
});

afterEach(() => {
  for (const db of opened) db.close();
  rmSync(dir, { recursive: true, force: true });
});

function openDb(): DB {
  const db = openWorldDb(dbPath);
  opened.push(db);
  return db;
}

function chatEvent(
  text: string,
): Pick<ChatMessageEvent, "userId" | "username" | "role" | "kind" | "text" | "createdAt"> {
  return { userId: "alice", username: "alice", role: "Player", kind: "chat", text, createdAt: Date.now() };
}

function rollEvent(text: string, notation: string): {
  base: Pick<ChatMessageEvent, "userId" | "username" | "role" | "kind" | "text" | "createdAt">;
  rolls: DiceRoll[];
  result: DiceResult;
  actor: RollActor;
} {
  return {
    base: { userId: "alice", username: "alice", role: "Player", kind: "roll", text, createdAt: Date.now() },
    rolls: [{ sign: 1, count: 2, sides: 20, kept: 1 }],
    result: {
      notation,
      terms: [
        { roll: { sign: 1, count: 2, sides: 20, kept: 1 }, rolls: [12, 7], kept: [12], dropped: [7], subtotal: 12 },
      ],
      modifier: 5,
      total: 17,
    },
    actor: { type: "user", userId: "alice", name: "alice" },
  };
}

describe("ChatStore", () => {
  it("appends a chat message and assigns seq/id", () => {
    const store = new ChatStore(openDb());
    const ev = store.append(chatEvent("hello"));
    expect(ev.type).toBe("ChatMessage");
    expect(ev.seq).toBe(1);
    expect(ev.id.length).toBeGreaterThan(0);
    expect(ev.text).toBe("hello");
    expect(ev.kind).toBe("chat");
  });

  it("recent() returns the last N in ascending seq", () => {
    const store = new ChatStore(openDb());
    for (let i = 0; i < 5; i++) store.append(chatEvent(`msg-${i}`));
    const out = store.recent(3);
    expect(out.map((e) => e.text)).toEqual(["msg-2", "msg-3", "msg-4"]);
    expect(out.map((e) => e.seq)).toEqual([3, 4, 5]);
  });

  it("recent(50) returns at most the limit", () => {
    const store = new ChatStore(openDb());
    for (let i = 0; i < 120; i++) store.append(chatEvent(`m-${i}`));
    expect(store.recent(50)).toHaveLength(50);
  });

  it("recent(limit, beforeSeq) paginates older messages", () => {
    const store = new ChatStore(openDb());
    for (let i = 0; i < 10; i++) store.append(chatEvent(`m-${i}`));
    const page = store.recent(3, 7);
    expect(page.map((e) => e.text)).toEqual(["m-3", "m-4", "m-5"]);
    expect(page.map((e) => e.seq)).toEqual([4, 5, 6]);
  });

  it("persists roll payload (rolls + result + actor)", () => {
    const store = new ChatStore(openDb());
    const r = rollEvent("/roll 2d20kh1+5", "2d20kh1+5");
    const ev = store.append({ ...r.base, rolls: r.rolls, result: r.result, actor: r.actor });
    expect(ev.kind).toBe("roll");
    expect(ev.rolls?.length).toBe(1);
    expect(ev.result?.total).toBe(17);
    expect(ev.actor).toEqual({ type: "user", userId: "alice", name: "alice" });
  });

  it("round-trips character actor", () => {
    const store = new ChatStore(openDb());
    const ev = store.append({
      userId: "alice",
      username: "alice",
      role: "Player",
      kind: "roll",
      text: "/roll 1d20",
      rolls: [{ sign: 1, count: 1, sides: 20 }],
      result: { notation: "1d20", terms: [], modifier: 0, total: 14 },
      actor: { type: "character", characterId: "char_42", name: "Goblin" },
      createdAt: Date.now(),
    });
    expect(ev.actor?.type).toBe("character");
    if (ev.actor?.type === "character") {
      expect(ev.actor.characterId).toBe("char_42");
      expect(ev.actor.name).toBe("Goblin");
    }
  });

  it("survives reopen with identical data", () => {
    {
      const db = openDb();
      const store = new ChatStore(db);
      for (let i = 0; i < 4; i++) store.append(chatEvent(`persist-${i}`));
      db.close();
    }
    const freshDb = openWorldDb(dbPath);
    opened.push(freshDb);
    const fresh = new ChatStore(freshDb);
    const out = fresh.recent(10);
    expect(out.map((e) => e.text)).toEqual([
      "persist-0",
      "persist-1",
      "persist-2",
      "persist-3",
    ]);
  });

  it("schema is at CORE_SCHEMA_VERSION after open", () => {
    const db = openDb();
    const row = db
      .prepare<[], { v: number }>(`SELECT v FROM _meta WHERE key='coreSchemaVersion'`)
      .get();
    expect(row?.v).toBe(CORE_SCHEMA_VERSION);
  });

  it("rejects worlds with newer schema", () => {
    const setupDb = openWorldDb(dbPath);
    try {
      setupDb.prepare(`UPDATE _meta SET v = ? WHERE key = 'coreSchemaVersion'`).run(CORE_SCHEMA_VERSION + 1);
    } finally {
      setupDb.close();
    }
    expect(() => openWorldDb(dbPath)).toThrow(/world-schema-newer/);
  });
});
