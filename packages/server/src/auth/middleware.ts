import type { Request, Response, NextFunction } from "express";
import { SESSION_COOKIE, verifySession } from "./jwt";
import type { SessionPayload } from "./jwt";

declare global {
  namespace Express {
    interface Request {
      user?: SessionPayload;
    }
  }
}

// Minimal cookie parser — no extra dep. Cookie header format:
//   name1=value1; name2=value2
export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function authMiddleware(secret: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    if (!token) return next();
    const session = verifySession(secret, token);
    if (session) req.user = session;
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

export function requireGm(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== "GM") {
    res.status(403).json({ error: "gm-only" });
    return;
  }
  next();
}