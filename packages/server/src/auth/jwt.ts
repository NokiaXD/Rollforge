import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import jwt from "jsonwebtoken";
import type { Role } from "./usersStore";

export interface SessionPayload {
  sub: string;
  role: Role;
}

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
export const SESSION_COOKIE = "rf_session";

// Load JWT secret: prefer env var, otherwise generate + persist to data/.jwt-secret.
// Auto-generation is for dev convenience; in prod set ROLLFORGE_JWT_SECRET explicitly.
export function loadJwtSecret(dataDir: string): string {
  const fromEnv = process.env.ROLLFORGE_JWT_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;

  mkdirSync(dataDir, { recursive: true });
  const file = `${dataDir}/.jwt-secret`;
  if (existsSync(file)) {
    const stored = readFileSync(file, "utf8").trim();
    if (stored.length >= 32) return stored;
  }
  const fresh = randomBytes(48).toString("hex");
  writeFileSync(file, fresh, { mode: 0o600 });
  mkdirSync(dirname(file), { recursive: true });
  return fresh;
}

export function signSession(secret: string, payload: SessionPayload): string {
  return jwt.sign(payload, secret, { expiresIn: TOKEN_TTL_SECONDS, algorithm: "HS256" });
}

export function verifySession(secret: string, token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof decoded === "string") return null;
    const sub = decoded.sub;
    const role = (decoded as { role?: unknown }).role;
    if (typeof sub !== "string" || (role !== "GM" && role !== "Player")) return null;
    return { sub, role };
  } catch {
    return null;
  }
}