import { AsyncLocalStorage } from "node:async_hooks";
import type { RollActorRef } from "@rollforge/protocol";

export interface InvocationContext {
  userId: string;
  username: string;
  role: "GM" | "Player";
  isGM: boolean;
  actor?: RollActorRef;
}

export const invocationStorage = new AsyncLocalStorage<InvocationContext>();
