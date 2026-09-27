import express, { type Express } from "express";
import { createServer, type Server as HttpServer } from "node:http";
import { join } from "node:path";
import { Server as SocketIOServer } from "socket.io";
import { attachSync, type SyncDeps } from "./sync/socket";
import { SceneState } from "./sync/sceneState";
import { DocumentStore } from "./db/documentStore";
import { UsersStore } from "./auth/usersStore";
import { loadJwtSecret, SESSION_COOKIE, verifySession } from "./auth/jwt";
import { LoginRateLimiter } from "./auth/rateLimit";
import { authMiddleware, parseCookies } from "./auth/middleware";
import { createAuthRouter } from "./auth/routes";
import { createUploadsRouter } from "./uploads";

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
  users: UsersStore | null;
  close: () => Promise<void>;
}

export function createRollforgeServer(opts: RollforgeServerOpts = {}): RollforgeServer {
  const app = express();
  const http = createServer(app);
  const io = new SocketIOServer(http, { cors: { origin: true, credentials: true } });
  const state = new SceneState({ store: opts.store ?? undefined });

  app.use(express.json({ limit: "12mb" }));

  const authEnabled = opts.auth !== null;
  const authCfg = opts.auth ?? {};
  const dataDir = opts.dataDir ?? "data";
  const uploadsDir = join(dataDir, "uploads");

  const users: UsersStore | null = authEnabled
    ? (authCfg.users ?? new UsersStore(`${dataDir}/users.db`))
    : null;

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

    // Static serve for uploaded images (referenced by SceneSystem.background).
    app.use("/uploads", express.static(uploadsDir, { maxAge: "1h" }));
    app.use("/api/uploads", createUploadsRouter({ dir: uploadsDir }));

    // Resolve socket userId from JWT cookie if present, else fall back to anon (Fase 0 compat).
    io.use((socket, next) => {
      const cookies = parseCookies(socket.handshake.headers.cookie);
      const token = cookies[SESSION_COOKIE];
      const session = token ? verifySession(secret, token) : null;
      socket.data.authSession = session;
      socket.data.role = session?.role ?? null;
      next();
    });

    attachSync(io, {
      state,
      resolveUserId: (socket) => socket.data.authSession?.sub ?? `user-${socket.id}`,
      resolveRole: (socket) => socket.data.role ?? null,
      // Paso 10: enforce active-scene gate in production. Tests opt out.
      gateSceneActive: true,
      ...authCfg.sync,
    });
  } else {
    app.use("/uploads", express.static(uploadsDir, { maxAge: "1h" }));
    app.use("/api/uploads", createUploadsRouter({ dir: uploadsDir }));
    attachSync(io, { state, ...opts.sync });
  }

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  return {
    app,
    http,
    io,
    state,
    store: opts.store ?? null,
    users,
    close: () =>
      new Promise<void>((resolve) => {
        io.close();
        http.close(() => {
          users?.close();
          opts.store?.close();
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