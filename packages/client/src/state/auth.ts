import { signal } from "@preact/signals";

export type AuthStatus = "loading" | "anon" | "authenticated";
export type Role = "GM" | "Player";

export interface CurrentUser {
  username: string;
  role: Role;
}

export interface PublicUser {
  username: string;
  role: Role;
  createdAt: number;
}

export const users = signal<PublicUser[]>([]);

export const authStatus = signal<AuthStatus>("loading");
export const currentUser = signal<CurrentUser | null>(null);

export async function fetchMe(): Promise<void> {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    if (res.status === 200) {
      const body = (await res.json()) as CurrentUser;
      currentUser.value = body;
      authStatus.value = "authenticated";
      return;
    }
  } catch {
    // fall through to anon
  }
  currentUser.value = null;
  authStatus.value = "anon";
}

export function setAuthenticated(user: CurrentUser): void {
  currentUser.value = user;
  authStatus.value = "authenticated";
}

export function setAnon(): void {
  currentUser.value = null;
  authStatus.value = "anon";
}