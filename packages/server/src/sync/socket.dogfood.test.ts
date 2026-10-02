import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
import { CommandRejection, type ServerExtensionAPI } from "@rollforge/extension-api";
import * as chatDice from "../extensions/builtins/chatDice";

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
  timeoutMs = 1500
): Promise<ChatMessageEvent> {
  const found = client.chatMessages.find(predicate);
  if (found) return Promise.resolve(found);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `waitForChat timed out; received: ${JSON.stringify(client.chatMessages)}`
        )
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

describe("Paso 12 — Extension architecture & Dogfood (socket.dogfood.test.ts)", () => {
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
    tmpDir = mkdtempSync(join(tmpdir(), "rollforge-dogfood-"));
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
      registerBuiltins: true,
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

  // Moved test verbatim
  it("/roll as user produces chatMessage with kind=roll, result.total>=2, actor=user", async () => {
    alice.socket.emit("chatMessage", { text: "/roll 2d20kh1+5" });
    const msg = await waitForChat(bob, (m) => m.kind === "roll");
    expect(msg.result?.total).toBeGreaterThanOrEqual(2);
    expect(msg.actor?.type).toBe("user");
    if (msg.actor?.type === "user") expect(msg.userId).toBe(alice.userId);
  });

  // Moved test verbatim
  it("/roll 1000000d20 rejects with dice-count-too-large", async () => {
    alice.socket.emit("chatMessage", { text: "/roll 1000000d20" });
    await new Promise((r) => setTimeout(r, 50));
    const reason = alice.rejections.find((r: any) => r.reason === "dice-count-too-large");
    expect(reason).toBeTruthy();
  });

  // Moved test verbatim
  it("/roll 1d6kh2 rejects with invalid-keep", async () => {
    alice.socket.emit("chatMessage", { text: "/roll 1d6kh2" });
    await new Promise((r) => setTimeout(r, 50));
    const reason = alice.rejections.find((r: any) => r.reason === "invalid-keep");
    expect(reason).toBeTruthy();
  });

  // Moved test verbatim
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

  it("whisper is persisted: saved in chatStore and delivered in chatHistory to sender/recipient", async () => {
    alice.socket.emit("chatMessage", { text: "/w bob secret" });
    await new Promise((r) => setTimeout(r, 80));

    // Whisper is persisted in chatStore
    const all = chatStore.recent(50);
    expect(all).toHaveLength(1);
    expect(all[0]?.text).toBe("secret");
    expect(all[0]?.whisperTo).toBe("bob");

    // Alice reconnects and sees the whisper in chatHistory
    const alice2 = await connect(port, aliceCookie);
    expect(alice2.chatHistory?.messages.some((m) => m.text === "secret")).toBe(true);
    alice2.socket.disconnect();

    // Bob reconnects and sees the whisper in chatHistory
    const bob2 = await connect(port, bobCookie);
    expect(bob2.chatHistory?.messages.some((m) => m.text === "secret")).toBe(true);
    bob2.socket.disconnect();

    // A third user (carol) connects and does NOT see the whisper in chatHistory
    const carolCookie = await register("carol-persisted", "pwpwpwpw");
    const carol = await connect(port, carolCookie);
    expect(carol.chatHistory?.messages.some((m) => m.text === "secret")).toBe(false);
    carol.socket.disconnect();
  });

  // Moved test verbatim
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

  // Moved test verbatim
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

  // 6.b: Test extension with preDiceRoll filter that modifies notation 1d20 -> 1d20+5
  it("applies preDiceRoll filter modifying notation to 1d20+5 and reflects in result", async () => {
    let capturedAPI: ServerExtensionAPI | null = null;
    server.extensions.registerExtension({
      manifest: {
        id: "modifier-plugin",
        name: "Modifier Plugin",
        version: "1.0.0",
        engines: { core: ">=0.1.0" },
        activationEvents: ["onReady"],
      },
      activate: (api) => {
        capturedAPI = api;
        api.hooks.filter("preDiceRoll", (val: any) => {
          if (val.notation === "1d20") {
            return { ...val, notation: "1d20+5" };
          }
          return val;
        });
      },
    });

    await server.extensions.ensureActivated("modifier-plugin");

    alice.socket.emit("chatMessage", { text: "/roll 1d20" });
    const msg = await waitForChat(bob, (m) => m.kind === "roll");
    expect(msg.result?.total).toBeGreaterThanOrEqual(6);

    // 6.c: The same test extension calls api.dice.roll directly (without chat) and filter applies
    expect(capturedAPI).not.toBeNull();
    const directResult = await capturedAPI!.dice.roll("1d20");
    expect(directResult.total).toBeGreaterThanOrEqual(6);
  });

  // 6.d: postDiceRoll listener receives the roll regardless of origin
  it("notifies postDiceRoll listener for both socket chat rolls and direct api.dice.roll", async () => {
    const postRolls: any[] = [];
    let capturedAPI: ServerExtensionAPI | null = null;

    server.extensions.registerExtension({
      manifest: {
        id: "listener-plugin",
        name: "Listener Plugin",
        version: "1.0.0",
        engines: { core: ">=0.1.0" },
        activationEvents: ["onReady"],
      },
      activate: (api) => {
        capturedAPI = api;
        api.hooks.on("postDiceRoll", (payload) => {
          postRolls.push(payload);
        });
      },
    });

    await server.extensions.ensureActivated("listener-plugin");

    // Socket roll
    alice.socket.emit("chatMessage", { text: "/roll 1d6" });
    await waitForChat(bob, (m) => m.kind === "roll");
    expect(postRolls.some((p) => p.notation === "1d6")).toBe(true);

    // Direct roll via API
    await capturedAPI!.dice.roll("2d6");
    expect(postRolls.some((p) => p.notation === "2d6")).toBe(true);
  });

  // 6.f: /roll 2d6 + 3 (with spaces) rejects with not-a-command
  it("rejects /roll 2d6 + 3 with not-a-command because rollHandler requires args.length === 1", async () => {
    alice.socket.emit("chatMessage", { text: "/roll 2d6 + 3" });
    await new Promise((r) => setTimeout(r, 60));
    const rej = alice.rejections.find((r) => r.reason === "not-a-command");
    expect(rej).toBeTruthy();
  });

  // 6.g: CommandRejection from handler and unexpected exception -> command-failed
  it("translates CommandRejection(reason) and maps unexpected exceptions to command-failed", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    server.extensions.registerExtension({
      manifest: {
        id: "error-probe",
        name: "Error Probe",
        version: "1.0.0",
        engines: { core: ">=0.1.0" },
        activationEvents: ["onCommand:reject-probe", "onCommand:crash-probe"],
        contributes: {
          chatCommands: [
            { name: "reject-probe", description: "Rejects with bad-notation" },
            { name: "crash-probe", description: "Crashes with TypeError" },
          ],
        },
      },
      activate: (api) => {
        api.chat.registerCommand({
          name: "reject-probe",
          description: "Rejects with bad-notation",
          handler: () => {
            throw new CommandRejection("bad-notation");
          },
        });
        api.chat.registerCommand({
          name: "crash-probe",
          description: "Crashes with TypeError",
          handler: () => {
            throw new TypeError("unexpected crash");
          },
        });
      },
    });

    alice.socket.emit("chatMessage", { text: "/reject-probe" });
    await new Promise((r) => setTimeout(r, 60));
    const rej1 = alice.rejections.find((r) => r.reason === "bad-notation");
    expect(rej1).toBeTruthy();

    alice.socket.emit("chatMessage", { text: "/crash-probe" });
    await new Promise((r) => setTimeout(r, 60));
    const rej2 = alice.rejections.find((r) => r.reason === "command-failed");
    expect(rej2).toBeTruthy();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[extension:error-probe] command \"crash-probe\" failed:"),
      expect.any(TypeError)
    );

    consoleSpy.mockRestore();
  });
});
