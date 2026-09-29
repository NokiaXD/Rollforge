import express, { type Express } from "express";
import { createServer, type Server as HttpServer } from "node:http";
import { join } from "node:path";
import { Server as SocketIOServer } from "socket.io";
import { attachSync, type SyncDeps } from "./sync/socket";
import { SceneState } from "./sync/sceneState";
import { DocumentStore } from "./db/documentStore";
import { ChatStore } from "./db/chatStore";
import { openWorldDb } from "./db/connection";
import { UsersStore } from "./auth/usersStore";
import { loadJwtSecret, SESSION_COOKIE, verifySession } from "./auth/jwt";
import { LoginRateLimiter } from "./auth/rateLimit";
import { authMiddleware, parseCookies } from "./auth/middleware";
import { createAuthRouter } from "./auth/routes";
import { createUploadsRouter } from "./uploads";
import type { Database as DB } from "better-sqlite3";
import { ExtensionManager, type ExtensionEntry } from "./extensions/manager";
import { ChatCommandRegistry } from "./extensions/registry";
import * as chatDice from "./extensions/builtins/chatDice";
import { HooksEngine, type ChatSendOptions } from "@rollforge/extension-api";
import { invocationStorage } from "./sync/invocationContext";
import type { ChatMessageEvent, Document, RollActor } from "@rollforge/protocol";

export interface AuthOpts {
  users?: UsersStore | null;
  secret?: string;
  rateLimiter?: LoginRateLimiter;
  cookieSecure?: boolean;
  sync?: Partial<SyncDeps>;
}

export interface RollforgeServerOpts {
  sync?: Partial<SyncDeps>;
  store?: DocumentStore | null;
  chatStore?: ChatStore | null;
  users?: UsersStore | null;
  auth?: AuthOpts | null;
  dataDir?: string;
  registerBuiltins?: boolean;
  activationTimeoutMs?: number;
}

export interface RollforgeServer {
  app: Express;
  http: HttpServer;
  io: SocketIOServer;
  state: SceneState;
  store: DocumentStore | null;
  chatStore: ChatStore | null;
  users: UsersStore | null;
  extensions: ExtensionManager;
  hooks: HooksEngine;
  close: () => Promise<void>;
}

const BUILTINS: ExtensionEntry[] = [chatDice];

export function createRollforgeServer(opts: RollforgeServerOpts = {}): RollforgeServer {
  const app = express();
  const http = createServer(app);
  const io = new SocketIOServer(http, { cors: { origin: true, credentials: true } });

  app.use(express.json({ limit: "12mb" }));

  const authEnabled = opts.auth !== null;
  const authCfg = opts.auth ?? {};
  const dataDir = opts.dataDir ?? "data";
  const uploadsDir = join(dataDir, "uploads");

  let worldDb: DB | null = null;
  let store: DocumentStore | null;
  let chatStore: ChatStore | null;

  const autoBuild = opts.store === undefined && opts.chatStore === undefined;
  if (autoBuild) {
    const dbPath = join(dataDir, "world.db");
    worldDb = openWorldDb(dbPath);
    store = new DocumentStore(worldDb);
    chatStore = new ChatStore(worldDb);
  } else {
    store = opts.store ?? null;
    chatStore = opts.chatStore ?? null;
  }

  const state = new SceneState({ store: store ?? undefined });

  const users: UsersStore | null = authEnabled
    ? (authCfg.users ?? new UsersStore(`${dataDir}/users.db`))
    : (opts.users ?? null);

  const hooks = new HooksEngine();
  const commandRegistry = new ChatCommandRegistry();

  const extensions = new ExtensionManager({
    hooks,
    commandRegistry,
    activationTimeoutMs: opts.activationTimeoutMs,
    getUsersAPI: () => ({
      findByName: (name: string) => {
        const target = name.trim().toLowerCase();
        if (!target) return null;
        const matches = new Map<string, string>();
        for (const s of io.sockets.sockets.values()) {
          const d = s.data as { userId?: string; username?: string };
          if (d.username && d.userId && d.username.toLowerCase() === target) {
            matches.set(d.userId, d.username);
          }
        }
        if (matches.size === 1) {
          const [id, username] = matches.entries().next().value!;
          return { id, name: username };
        }
        return null;
      },
    }),
    getDocumentsAPI: () => ({
      get: async <T extends Document = Document>(id: string) =>
        (store ? ((store.getById(id) as T | null) ?? null) : null),
      create: async <T extends Document>(input: Omit<T, "_rev">) => {
        if (!store) throw new Error("DocumentStore unavailable");
        return store.save(input as any) as any;
      },
      update: async <T extends Document>(id: string, patch: Partial<T>) => {
        if (!store) throw new Error("DocumentStore unavailable");
        const existing = store.getById(id);
        if (!existing) throw new Error(`Document ${id} not found`);
        return store.update({ ...existing, ...patch } as any, existing._rev) as any;
      },
      delete: async (id: string) => {
        if (!store) throw new Error("DocumentStore unavailable");
        store.delete(id);
      },
    }),
    getDocumentStore: () => store,
    getChatSendHandler: () => async (message: string, chatOpts?: ChatSendOptions) => {
      const current = invocationStorage.getStore();
      const senderUserId = current?.userId ?? "system";
      const senderUsername = current?.username ?? "System";
      const senderRole = current?.role ?? "GM";
      const now = Date.now();

      if (chatOpts?.kind === "whisper") {
        let recipientUsername: string | undefined;
        if (chatOpts.to) {
          for (const s of io.sockets.sockets.values()) {
            const d = s.data as { userId?: string; username?: string };
            if (d.userId === chatOpts.to || d.username === chatOpts.to) {
              recipientUsername = d.username ?? d.userId;
              break;
            }
          }
        }
        const whisperToName = recipientUsername ?? chatOpts.to;
        const ev: ChatMessageEvent = {
          type: "ChatMessage",
          seq: 0,
          id: `w-${now}-${senderUserId}`,
          userId: senderUserId,
          username: senderUsername,
          role: senderRole,
          kind: "chat",
          text: message,
          createdAt: now,
          ...(whisperToName ? { whisperTo: whisperToName } : {}),
        };
        let emitter = io.to(`user:${senderUserId}`);
        if (chatOpts.to) {
          emitter = emitter.to(`user:${chatOpts.to}`);
        }
        if (whisperToName && whisperToName !== chatOpts.to) {
          emitter = emitter.to(`user:${whisperToName}`);
        }
        emitter.emit("chatMessage", ev);
        return;
      }

      if (chatOpts?.kind === "roll") {
        if (chatStore) {
          let rollActor: RollActor;
          if (chatOpts.actor) {
            rollActor = chatOpts.actor;
          } else if (current?.actor?.type === "character") {
            const charDoc = store ? store.getById(current.actor.characterId) : null;
            rollActor = {
              type: "character",
              characterId: current.actor.characterId,
              name: charDoc?.name ?? "(unknown)",
            };
          } else {
            rollActor = {
              type: "user",
              userId: senderUserId,
              name: senderUsername,
            };
          }

          const ev = chatStore.append({
            userId: senderUserId,
            username: senderUsername,
            role: senderRole,
            kind: "roll",
            text: message,
            rolls: chatOpts.rolls ?? chatOpts.result?.terms?.map((t: any) => t.roll),
            result: chatOpts.result,
            actor: rollActor,
            createdAt: now,
          });
          io.to("world").emit("chatMessage", ev);
        }
        return;
      }

      if (chatStore) {
        const ev = chatStore.append({
          userId: senderUserId,
          username: senderUsername,
          role: senderRole,
          kind: "chat",
          text: message,
          createdAt: now,
        });
        io.to("world").emit("chatMessage", ev);
      }
    },
  });

  const shouldRegisterBuiltins = opts.registerBuiltins ?? true;
  if (shouldRegisterBuiltins) {
    for (const b of BUILTINS) {
      extensions.registerExtension(b);
    }
  }

  void extensions.dispatchActivationEvent("onReady");

  if (authEnabled && users) {
    const secret = authCfg.secret ?? loadJwtSecret(dataDir);
    const limiter = authCfg.rateLimiter ?? new LoginRateLimiter();

    app.use(authMiddleware(secret));
    app.use(
      "/api/auth",
      createAuthRouter({
        users,
        secret,
        rateLimiter: limiter,
        cookieSecure: authCfg.cookieSecure,
      }),
    );

    app.use("/uploads", express.static(uploadsDir, { maxAge: "1h" }));
    app.use("/api/uploads", createUploadsRouter({ dir: uploadsDir }));

    io.use((socket, next) => {
      const cookies = parseCookies(socket.handshake.headers.cookie);
      const token = cookies[SESSION_COOKIE];
      const session = token ? verifySession(secret, token) : null;
      socket.data.authSession = session;
      socket.data.role = session?.role ?? null;
      socket.data.username = session?.sub ?? null;
      next();
    });

    attachSync(io, {
      state,
      resolveUserId: (socket) => socket.data.authSession?.sub ?? `user-${socket.id}`,
      resolveRole: (socket) => socket.data.role ?? null,
      resolveUsername: (socket) =>
        socket.data.username ?? socket.data.authSession?.sub ?? `user-${socket.id}`,
      gateSceneActive: true,
      chatStore,
      users,
      documents: store,
      extensionManager: extensions,
      hooks,
      ...authCfg.sync,
    });
  } else {
    app.use("/uploads", express.static(uploadsDir, { maxAge: "1h" }));
    app.use("/api/uploads", createUploadsRouter({ dir: uploadsDir }));
    attachSync(io, {
      state,
      users,
      documents: store,
      chatStore,
      extensionManager: extensions,
      hooks,
      ...opts.sync,
    });
  }

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  return {
    app,
    http,
    io,
    state,
    store,
    chatStore,
    users,
    extensions,
    hooks,
    close: async () => {
      const allExts = Array.from(extensions["extensions"].keys());
      for (const id of allExts) {
        await extensions.deactivateExtension(id);
      }
      return new Promise<void>((resolve) => {
        io.close();
        http.close(() => {
          users?.close();
          opts.store?.close();
          opts.chatStore?.close();
          worldDb?.close();
          resolve();
        });
      });
    },
  };
}

export function listen(server: RollforgeServer, port: number): Promise<number> {
  return new Promise((resolve) => {
    server.http.listen(port, () => {
      const addr = server.http.address();
      const actual = typeof addr === "object" && addr ? addr.port : port;
      resolve(actual);
    });
  });
}
