import { Router, type Request, type Response } from "express";
import { UsersStore, type Role } from "./usersStore";
import { hashPassword, verifyPassword } from "./password";
import { signSession, SESSION_COOKIE } from "./jwt";
import { LoginRateLimiter } from "./rateLimit";
import { requireAuth, requireGm } from "./middleware";

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/;
const MIN_PASSWORD_LEN = 8;

const COOKIE_BASE = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
};

export interface AuthDeps {
  users: UsersStore;
  secret: string;
  rateLimiter: LoginRateLimiter;
  // test-only: skip secure-cookie check. Production sets it via NODE_ENV.
  cookieSecure?: boolean | undefined;
}

export function createAuthRouter(deps: AuthDeps): Router {
  const { users, secret, rateLimiter } = deps;
  const secure = deps.cookieSecure ?? process.env.NODE_ENV === "production";
  const router = Router();

  // Register a new account. First user auto-becomes GM, rest default to Player.
  router.post("/register", async (req: Request, res: Response) => {
    const { username, password } = (req.body ?? {}) as {
      username?: unknown;
      password?: unknown;
    };
    if (typeof username !== "string" || !USERNAME_RE.test(username)) {
      res.status(400).json({ error: "invalid-username" });
      return;
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LEN) {
      res.status(400).json({ error: "weak-password" });
      return;
    }
    const role: Role = users.isFirstUser() ? "GM" : "Player";
    const hash = await hashPassword(password);
    try {
      users.createUser(username, hash, role);
    } catch {
      res.status(409).json({ error: "username-taken" });
      return;
    }
    const token = signSession(secret, { sub: username, role });
    res.cookie(SESSION_COOKIE, token, { ...COOKIE_BASE, secure });
    res.status(201).json({ username, role });
  });

  // Login: returns JWT cookie on success.
  router.post("/login", async (req: Request, res: Response) => {
    const { username, password } = (req.body ?? {}) as {
      username?: unknown;
      password?: unknown;
    };
    if (typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "bad-request" });
      return;
    }
    const key = `${username}:${req.ip ?? "?"}`;
    const blocked = rateLimiter.check(key);
    if (blocked !== null) {
      res.status(429).json({ error: "rate-limited", retryAfterSeconds: blocked });
      return;
    }
    const user = users.getByUsername(username);
    if (!user) {
      rateLimiter.recordFailure(key);
      res.status(401).json({ error: "invalid-credentials" });
      return;
    }
    let ok = false;
    try {
      ok = await verifyPassword(password, user.passwordHash);
    } catch {
      ok = false;
    }
    if (!ok) {
      rateLimiter.recordFailure(key);
      res.status(401).json({ error: "invalid-credentials" });
      return;
    }
    rateLimiter.recordSuccess(key);
    const token = signSession(secret, { sub: user.username, role: user.role });
    res.cookie(SESSION_COOKIE, token, { ...COOKIE_BASE, secure });
    res.json({ username: user.username, role: user.role });
  });

  router.post("/logout", (_req: Request, res: Response) => {
    res.clearCookie(SESSION_COOKIE, COOKIE_BASE);
    res.json({ ok: true });
  });

  router.get("/me", requireAuth, (req: Request, res: Response) => {
    res.json({ username: req.user!.sub, role: req.user!.role });
  });

  // GM lists all users (no password hashes). Used by the GM panel.
  router.get("/users", requireAuth, requireGm, (_req: Request, res: Response) => {
    res.json(users.listUsers());
  });

  // GM resets another user's password. Used when a player forgets it.
  router.post("/gm/reset-password", requireAuth, requireGm, async (req: Request, res: Response) => {
    const { username, newPassword } = (req.body ?? {}) as {
      username?: unknown;
      newPassword?: unknown;
    };
    if (typeof username !== "string" || typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LEN) {
      res.status(400).json({ error: "bad-request" });
      return;
    }
    const target = users.getByUsername(username);
    if (!target) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    const newHash = await hashPassword(newPassword);
    users.setPasswordHash(username, newHash);
    res.json({ ok: true });
  });

  // GM deletes another user. Refuses self-delete and last-GM.
  router.delete("/users/:username", requireAuth, requireGm, (req: Request, res: Response) => {
    const target = req.params.username;
    if (typeof target !== "string" || !target) {
      res.status(400).json({ error: "bad-request" });
      return;
    }
    if (target === req.user!.sub) {
      res.status(400).json({ error: "cannot-delete-self" });
      return;
    }
    const record = users.getByUsername(target);
    if (!record) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    if (record.role === "GM" && users.countByRole("GM") <= 1) {
      res.status(400).json({ error: "cannot-delete-last-gm" });
      return;
    }
    users.deleteUser(target);
    res.json({ ok: true });
  });

  return router;
}