import type { DiceResult, RollActorRef } from "./dice";

export type CoreHookName = "ready" | "preChatMessage" | "preDiceRoll" | "postDiceRoll";
export type HookName = CoreHookName | (string & {});

export interface PreChatMessagePayload {
  text: string;
  userId: string;
  isGM: boolean;
}

export interface PreDiceRollPayload {
  notation: string;
  userId: string;
  actor?: RollActorRef;
}

export interface PostDiceRollPayload {
  notation: string;
  userId: string;
  result: DiceResult;
  actor: RollActorRef;
}

export type NotifyHandler<T = unknown> = (payload: T) => void | Promise<void>;

export type FilterHandler<T = unknown> = (
  value: T,
) => T | null | Promise<T | null>;

export interface HooksAPI {
  on<T = unknown>(event: HookName, handler: NotifyHandler<T>): void;
  filter<T = unknown>(event: HookName, handler: FilterHandler<T>, opts?: { priority?: number }): void;
  off(event: HookName, handler: NotifyHandler<any> | FilterHandler<any>): void;
}