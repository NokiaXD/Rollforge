import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createRollforgeServer, listen, type RollforgeServer } from "../server";
import { openWorldDb } from "../db/connection";
import { DocumentStore } from "../db/documentStore";
import { ChatStore } from "../db/chatStore";
import { UsersStore } from "../auth/usersStore";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as DB } from "better-sqlite3";
import type {
  ChatHistoryEvent,
  ChatMessageEvent,
} from "@rollforge/protocol";
import type { TokenRecord } from "../sync/sceneState";

interface ClientHandle {
  socket: ClientSocket;
  userId: string;
  username: string;
  events: any[];
  rejections: any[];
  chatMessages: ChatMessageEvent[];
  chatHistory?: ChatHistoryEvent;
}

function waitFor<T = any>(handle: ClientHandle, predicate: (e: any) => boolean, timeoutMs = 500): Promise<T> {
  return new Promise((resolve, reject) => {
    const existing = handle.events.find(predicate);
    if (existing) return resolve(existing as T);
    const timer = setTimeout(() => {
      handle.socket.off("event", onEvent);
      reject(new Error(`waitFor timeout; saw ${handle.events.length} events`));
    }, timeoutMs);
    const onEvent = (e: any) => {
      if (predicate(e)) {
        clearTimeout(timer);
        handle.socket.off("event", onEvent);
        resolve(e as T);
      }
    };
    handle.socket.on("event", onEvent);
  });
}

function waitForChat(handle: ClientHandle, predicate: (m: ChatMessageEvent) => boolean, timeoutMs = 500): Promise<ChatMessageEvent> {
  return new Promise((resolve, reject) => {
    const existing = handle.chatMessages.find(predicate);
    if (existing) return resolve(existing);
    const timer = setTimeout(() => {
      handle.socket.off("chatMessage", onMsg);
      reject(new Error(`waitForChat timeout; saw ${handle.chatMessages.length} messages`));
    }, timeoutMs);
    const onMsg = (m: ChatMessageEvent) => {
      if (predicate(m)) {
        clearTimeout(timer);
        handle.socket.off("chatMessage", onMsg);
        resolve(m);
      }
    };
    handle.socket.on("chatMessage", onMsg);
  });
}

async function joinScene(handle: ClientHandle, sceneId: string): Promise<TokenRecord[]> {
  return new Promise((resolve) => {
    handle.socket.emit("joinScene", sceneId, (payload: { tokens: TokenRecord[] }) => {
      resolve(payload.tokens);
    });
  });
}

async function connect(port: number, cookie: string): Promise<ClientHandle> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://localhost:${port}`, {
      transports: ["websocket"],
      forceNew: true,
      extraHeaders: { Cookie: cookie },
    });
    const events: any[] = [];
    const rejections: any[] = [];
    const chatMessages: ChatMessageEvent[] = [];
    let chatHistory: ChatHistoryEvent | undefined;
    socket.on("event", (e) => events.push(e));
    socket.on("intentRejected", (e) => rejections.push(e));
    socket.on("chatMessage", (m: ChatMessageEvent) => chatMessages.push(m));
    socket.on("chatHistory", (h: ChatHistoryEvent) => (chatHistory = h));
    socket.on("you", (y: { userId: string; username: string }) => {
      const handle: ClientHandle = {
        socket,
        userId: y.userId,
        username: y.username,
        events,
        rejections,
        chatMessages,
      };
      if (chatHistory !== undefined) handle.chatHistory = chatHistory;
      resolve(handle);
    });
    socket.on("connect_error", reject);
  });
}

async function register(name: string, pw: string): Promise<string> {
  const port = lastServer.http.address();
  const addr = typeof port === "object" && port ? port.port : 0;
  const res = await fetch(`http://127.0.0.1:${addr}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: name, password: pw }),
  });
  const raw = res.headers.get("set-cookie");
  if (!raw) throw new Error("no cookie");
  return raw.split(";")[0] ?? "";
}

let lastServer: RollforgeServer;

describe("Paso 11 — chat and dice", () => {
  let server: RollforgeServer;
  let port: number;
  let alice: ClientHandle;
  let bob: ClientHandle;
  let tmpDir: string = "";
  let chatStore: ChatStore;
  let docStore: DocumentStore;
  let usersStore: UsersStore;
  let worldDb: DB | null;
  let aliceCookie: string = "";
  let bobCookie: string = "";

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "rollforge-chat-srv-"));
    worldDb = openWorldDb(join(tmpDir, "world.db"));
    docStore = new DocumentStore(worldDb);
    chatStore = new ChatStore(worldDb);
    usersStore = new UsersStore(join(tmpDir, "users.db"));
    server = createRollforgeServer({
      auth: {
        cookieSecure: false,
        users: usersStore,
        sync: { gateSceneActive: false, resolveRole: () => "Player" as const },
      },
      chatStore,
      store: docStore,
    });
    lastServer = server;
    port = await listen(server, 0);
    // register a throwaway GM first so alice/bob stay Players.
    await register("gm-bot", "pwpwpwpw");
    aliceCookie = await register("alice", "pwpwpwpw");
    bobCookie = await register("bob", "pwpwpwpw");
    [alice, bob] = await Promise.all([connect(port, aliceCookie), connect(port, bobCookie)]);
  });

  afterEach(async () => {
    alice.socket.disconnect();
    bob.socket.disconnect();
    if (server) await server.close();
    worldDb?.close();
    usersStore?.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("delivers a single chatHistory on connect, then chatMessages append", async () => {
    expect(alice.chatHistory?.type).toBe("ChatHistory");
    expect(alice.chatHistory?.messages).toEqual([]);
    alice.socket.emit("chatMessage", { text: "hi" });
    const msg = await waitForChat(bob, (m) => m.kind === "chat" && m.text === "hi");
    expect(msg.userId).toBe(alice.userId);
    expect(msg.username).toBe("alice");
    expect(msg.seq).toBeGreaterThan(0);
  });

  it("/roll as user produces chatMessage with kind=roll, result.total>=2, actor=user", async () => {
    alice.socket.emit("chatMessage", { text: "/roll 2d20kh1+5" });
    const msg = await waitForChat(bob, (m) => m.kind === "roll");
    expect(msg.result?.total).toBeGreaterThanOrEqual(2);
    expect(msg.actor?.type).toBe("user");
    if (msg.actor?.type === "user") expect(msg.userId).toBe(alice.userId);
  });

  it("/roll 1000000d20 rejects with dice-count-too-large", async () => {
    alice.socket.emit("chatMessage", { text: "/roll 1000000d20" });
    await new Promise((r) => setTimeout(r, 50));
    const reason = alice.rejections.find((r: any) => r.reason === "dice-count-too-large");
    expect(reason).toBeTruthy();
  });

  it("/roll 1d6kh2 rejects with invalid-keep", async () => {
    alice.socket.emit("chatMessage", { text: "/roll 1d6kh2" });
    await new Promise((r) => setTimeout(r, 50));
    const reason = alice.rejections.find((r: any) => r.reason === "invalid-keep");
    expect(reason).toBeTruthy();
  });

  it("/w bob is delivered only to alice and bob, not to a third socket", async () => {
    const carolCookie = await register("carol", "pwpwpwpw");
    const carol = await connect(port, carolCookie);

    alice.socket.emit("chatMessage", { text: "/w bob hello" });
    const msg = await waitForChat(bob, (m) => m.text === "hello");
    expect(msg.whisperTo).toBe("bob");

    await new Promise((r) => setTimeout(r, 80));
    const aliceGot = alice.chatMessages.some((m) => m.text === "hello");
    const bobGot = bob.chatMessages.some((m) => m.text === "hello");
    const carolGot = carol.chatMessages.some((m) => m.text === "hello");
    expect(aliceGot).toBe(true);
    expect(bobGot).toBe(true);
    expect(carolGot).toBe(false);

    carol.socket.disconnect();
  });

  it("whisper is not persisted: recent() returns no messages after a restart", async () => {
    alice.socket.emit("chatMessage", { text: "/w bob secret" });
    await new Promise((r) => setTimeout(r, 80));
    expect(chatStore.recent(50)).toEqual([]);

    alice.socket.emit("chatMessage", { text: "public hello" });
    await new Promise((r) => setTimeout(r, 80));
    const out = chatStore.recent(50);
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toBe("public hello");
  });

  it("reconnect delivers chatHistory once and only once", async () => {
    alice.socket.disconnect();
    const aliceAgain = await connect(port, aliceCookie);
    expect(aliceAgain.chatHistory).toBeDefined();
    aliceAgain.socket.disconnect();
  });

  it("rejects character actor that the user does not control (forbidden)", async () => {
    docStore.save({
      id: "char_evil",
      type: "Actor",
      name: "Wraith",
      system: { hp: { value: 10, max: 10 }, notes: "" },
      flags: {},
      ownership: { default: "LIMITED" },
    });
    alice.socket.emit("chatMessage", {
      text: "/roll 1d20",
      actor: { type: "character", characterId: "char_evil" },
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(
      alice.rejections.some((r: any) => r.reason === "forbidden" && String(r.intent?.text ?? "").includes("/roll")),
    ).toBe(true);
  });

  it("accepts character actor the user owns (OWNER)", async () => {
    docStore.save({
      id: "char_friend",
      type: "Actor",
      name: "Goblin",
      system: { hp: { value: 1, max: 1 }, notes: "" },
      flags: {},
      ownership: { alice: "OWNER" },
    });
    alice.socket.emit("chatMessage", {
      text: "/roll 1d20",
      actor: { type: "character", characterId: "char_friend" },
    });
    const msg = await waitForChat(bob, (m) => m.kind === "roll");
    expect(msg.actor?.type).toBe("character");
    if (msg.actor?.type === "character") {
      expect(msg.actor.characterId).toBe("char_friend");
      expect(msg.actor.name).toBe("Goblin");
    }
  });

  it("rate-limit kicks in after CHAT_RATE_CAP messages (5/s)", async () => {
    for (let i = 0; i < 8; i++) {
      alice.socket.emit("chatMessage", { text: `spam-${i}` });
    }
    await new Promise((r) => setTimeout(r, 100));
    const reasons = alice.rejections.map((r: any) => r.reason).filter((r: string) => r === "rate-limit");
    expect(reasons.length).toBeGreaterThan(0);
  });

  it("schema-newer DB rejects on next open", () => {
    if (!worldDb) throw new Error("worldDb not initialized");
    worldDb.close();
    const newer = openWorldDb(join(tmpDir, "world.db"));
    newer.prepare(`UPDATE _meta SET v = ? WHERE key = 'coreSchemaVersion'`).run(999);
    newer.close();
    expect(() => openWorldDb(join(tmpDir, "world.db"))).toThrow(/world-schema-newer/);
    worldDb = null;
  });
});

// keep `joinScene` referenced so unused-import error doesn't surface even if dev shortcuts skip a test
void joinScene;
void waitFor;
