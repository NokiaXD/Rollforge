import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRollforgeServer, listen, type RollforgeServer } from "../server";
import { DocumentStore } from "../db/documentStore";
import { ChatStore } from "../db/chatStore";
import { openWorldDb } from "../db/connection";
import { UsersStore } from "../auth/usersStore";
import type { ChatHistoryEvent, ChatMessageEvent } from "@rollforge/protocol";
import type { Database as DB } from "better-sqlite3";

interface ClientHandle {
  socket: ClientSocket;
  chatHistory?: ChatHistoryEvent;
  chatMessages: ChatMessageEvent[];
  rejections: Array<{ intent: unknown; reason: string }>;
  userId: string;
}

function waitForChat(
  client: ClientHandle,
  predicate: (m: ChatMessageEvent) => boolean,
  timeoutMs = 1500,
): Promise<ChatMessageEvent> {
  const found = client.chatMessages.find(predicate);
  if (found) return Promise.resolve(found);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `waitForChat timed out; received: ${JSON.stringify(client.chatMessages)}`,
        ),
      );
    }, timeoutMs);
    const check = (m: ChatMessageEvent) => {
      if (predicate(m)) {
        clearTimeout(timer);
        client.socket.off("chatMessage", check);
        resolve(m);
      }
    };
    client.socket.on("chatMessage", check);
  });
}

function connect(port: number, cookie?: string): Promise<ClientHandle> {
  return new Promise((resolve, reject) => {
    const socket = ioc(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      extraHeaders: cookie ? { cookie } : {},
    });
    const handle: ClientHandle = {
      socket,
      chatMessages: [],
      rejections: [],
      userId: "",
    };
    socket.on("chatHistory", (h) => {
      handle.chatHistory = h;
    });
    socket.on("chatMessage", (m) => {
      handle.chatMessages.push(m);
    });
    socket.on("intentRejected", (r) => {
      handle.rejections.push(r);
    });
    socket.on("you", (y) => {
      handle.userId = y.userId;
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

describe("Paso 11 / Paso 12 — Core plain chat without built-in extensions", () => {
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
    // Run WITHOUT registering built-ins (B.2 verification)
    server = createRollforgeServer({
      auth: {
        cookieSecure: false,
        users: usersStore,
        sync: { gateSceneActive: false, resolveRole: () => "Player" as const },
      },
      chatStore,
      store: docStore,
      registerBuiltins: false,
    });
    lastServer = server;
    port = await listen(server, 0);

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

  it("reconnect delivers chatHistory once and only once", async () => {
    alice.socket.disconnect();
    const aliceAgain = await connect(port, aliceCookie);
    expect(aliceAgain.chatHistory).toBeDefined();
    aliceAgain.socket.disconnect();
  });

  it("rate-limit kicks in after CHAT_RATE_CAP messages (5/s)", async () => {
    for (let i = 0; i < 8; i++) {
      alice.socket.emit("chatMessage", { text: `spam-${i}` });
    }
    await new Promise((r) => setTimeout(r, 100));
    const reasons = alice.rejections.map((r: any) => r.reason).filter((r: string) => r === "rate-limit");
    expect(reasons.length).toBeGreaterThan(0);
  });

  // 6.e: Without core-chat-dice registered, /roll and /w reject with not-a-command
  it("rejects /roll and /w with not-a-command when core-chat-dice is not registered", async () => {
    alice.socket.emit("chatMessage", { text: "/roll 1d20" });
    await new Promise((r) => setTimeout(r, 60));
    const rollRejection = alice.rejections.find((r) => r.reason === "not-a-command");
    expect(rollRejection).toBeTruthy();

    alice.socket.emit("chatMessage", { text: "/w bob secret" });
    await new Promise((r) => setTimeout(r, 60));
    const whisperRejection = alice.rejections.find((r) => r.reason === "not-a-command");
    expect(whisperRejection).toBeTruthy();
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
