import { setAuthenticated, setAnon, users } from "../state/auth";
import type { CurrentUser, PublicUser } from "../state/auth";

export interface AuthError {
  status: number;
  code: string;
  retryAfterSeconds?: number | undefined;
}

async function readError(res: Response): Promise<AuthError> {
  let code = "request-failed";
  let retryAfterSeconds: number | undefined;
  try {
    const body = (await res.json()) as { error?: string; retryAfterSeconds?: number };
    if (typeof body.error === "string") code = body.error;
    if (typeof body.retryAfterSeconds === "number") retryAfterSeconds = body.retryAfterSeconds;
  } catch {
    // body wasn't JSON
  }
  return { status: res.status, code, retryAfterSeconds };
}

async function authCall(action: "login" | "register", username: string, password: string): Promise<AuthError | null> {
  const res = await fetch(`/api/auth/${action}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (res.ok) {
    const user = (await res.json()) as CurrentUser;
    setAuthenticated(user);
    return null;
  }
  return readError(res);
}

export const login = (username: string, password: string) => authCall("login", username, password);
export const register = (username: string, password: string) => authCall("register", username, password);

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  setAnon();
  users.value = [];
}

export async function listUsers(): Promise<PublicUser[] | null> {
  const res = await fetch("/api/auth/users", { credentials: "include" });
  if (!res.ok) return null;
  const list = (await res.json()) as PublicUser[];
  users.value = list;
  return list;
}

export async function gmResetPassword(username: string, newPassword: string): Promise<AuthError | null> {
  const res = await fetch("/api/auth/gm/reset-password", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, newPassword }),
  });
  if (res.ok) return null;
  return readError(res);
}

export async function gmDeleteUser(username: string): Promise<AuthError | null> {
  const res = await fetch(`/api/auth/users/${encodeURIComponent(username)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (res.ok) return null;
  return readError(res);
}