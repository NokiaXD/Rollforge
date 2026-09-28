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

export interface AuthOpts {
  users?: UsersStore | null;
  secret?: string;
  rateLimiter?: LoginRateLimiter;
  cookieSecure?: boolean;
  sync?: Partial<SyncDeps>;
}

export interface RollforgeServerOpts {
  sync?: Partial<SyncDeps>;
  // Pass null to disable world persistence (tests).
  store?: DocumentStore | null;
  // Paso 11: chat store; pass null to disable chat. If both store and chatStore are
  // omitted, the server opens a world DB and constructs one DocumentStore + ChatStore
  // sharing a single better-sqlite3 handle.
  chatStore?: ChatStore | null;
  // Optional users store wiring for whisper recipient resolution.
  users?: UsersStore | null;
  // Pass null to disable auth entirely (tests / pre-Fase-1 dev).
  auth?: AuthOpts | null;
  dataDir?: string;
}

export interface RollforgeServer {
  app: Express;
  http: HttpServer;
  io: SocketIOServer;
  state: SceneState;
  store: DocumentStore | null;
  chatStore: ChatStore | null;
  users: UsersStore | null;
  close: () => Promise<void>;
}

export function createRollforgeServer(opts: RollforgeServerOpts = {}): RollforgeServer {
  const app = express();
  const http = createServer(app);
  const io = new SocketIOServer(http, { cors: { origin: true, credentials: true } });

  app.use(express.json({ limit: "12mb" }));

  const authEnabled = opts.auth !== null;
  const authCfg = opts.auth ?? {};
  const dataDir = opts.dataDir ?? "data";
  const uploadsDir = join(dataDir, "uploads");

  // when callers don't supply either store, auto-build a shared SQLite handle.
  // If they pass one (or `null`), we use it as-is and skip auto-build — that matches the
  // test pattern of "make a store from my own db handle" without us fighting for control.
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

  // Construct the SceneState ONCE. Both the sync layer and `server.state` reference the
  // same instance so tests can seed tokens/scenes via server.state and the socket
  // handlers see them live.
  const state = new SceneState({ store: store ?? undefined });

  const users: UsersStore | null = authEnabled
    ? (authCfg.users ?? new UsersStore(`${dataDir}/users.db`))
    : (opts.users ?? null);

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
    close: () =>
      new Promise<void>((resolve) => {
        io.close();
        http.close(() => {
          users?.close();
          opts.store?.close();
          opts.chatStore?.close();
          // when the server opened its own DB, that handle outlives
          // the stores and must be closed here.
          worldDb?.close();
          resolve();
        });
      }),
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
