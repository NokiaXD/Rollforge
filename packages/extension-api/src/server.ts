import type {
  Document,
  HookName,
  NotifyHandler,
  FilterHandler,
  DiceResult,
  RollActorRef,
  RollActor,
} from "@rollforge/protocol";
import { CommandRejection, errors } from "./errors";

export interface DocumentsAPI {
  get<T extends Document = Document>(id: string): Promise<T | null>;
  create<T extends Document>(input: Omit<T, "_rev">): Promise<T>;
  update<T extends Document>(id: string, patch: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
}

export interface ChatSendOptions {
  to?: string;
  kind?: "chat" | "whisper" | "system" | "roll";
  rolls?: any[];
  result?: any;
  actor?: RollActor;
}

export interface CommandHandlerCtx {
  userId: string;
  isGM: boolean;
}

export type CommandHandler = (
  args: { args: string[]; rest: string },
  ctx: CommandHandlerCtx
) => Promise<void> | void;

export interface ChatCommandRegistration {
  name: string;
  description: string;
  handler: CommandHandler;
  requiredPermission?: "GM" | "Player";
}

export interface ChatAPI {
  send(message: string, opts?: ChatSendOptions): Promise<void>;
  registerCommand(cmd: ChatCommandRegistration): void;
}

export interface DiceAPI {
  roll(notation: string, opts?: { actor?: RollActorRef; userId?: string }): Promise<DiceResult>;
}

export interface UsersAPI {
  findByName(name: string): { id: string; name: string } | null;
}

export interface ExtensionHooksAPI {
  on<T = unknown>(event: HookName, handler: NotifyHandler<T>): void;
  filter<T = unknown>(event: HookName, handler: FilterHandler<T>, opts?: { priority?: number }): void;
  off(event: HookName, handler: NotifyHandler<any> | FilterHandler<any>): void;
}

export interface ServerExtensionContext {
  extensionId: string;
}

export interface ServerExtensionAPI {
  documents: DocumentsAPI;
  hooks: ExtensionHooksAPI;
  chat: ChatAPI;
  dice: DiceAPI;
  users: UsersAPI;
  context: ServerExtensionContext;
  errors: {
    CommandRejection: typeof CommandRejection;
  };
}

export function deepFreeze<T>(obj: T, seen = new Set<unknown>()): T {
  if (obj === null || typeof obj !== "object") {
    if (typeof obj === "function" && !Object.isFrozen(obj)) {
      return Object.freeze(obj);
    }
    return obj;
  }
  if (seen.has(obj)) {
    return obj;
  }
  seen.add(obj);

  const propNames = Object.getOwnPropertyNames(obj);
  for (const name of propNames) {
    const val = (obj as any)[name];
    if (val && typeof val === "object" && !Object.isFrozen(val)) {
      deepFreeze(val, seen);
    } else if (val && typeof val === "function" && !Object.isFrozen(val)) {
      Object.freeze(val);
    }
  }
  return Object.freeze(obj);
}

export const freezeServerAPI = deepFreeze;