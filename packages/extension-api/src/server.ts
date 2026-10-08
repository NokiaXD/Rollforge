import type {
  Document,
  HookName,
  MigrationChain,
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
  // Paso 15 — register a chain of single-version migrations for a document
  // type this extension owns. The chain must be contiguous and end at the
  // schemaVersion declared in the manifest. Returns ok=false on validation
  // failures so the host can mark the extension Incompatible without
  // throwing out of the load loop.
  registerMigrations<TSystem = Record<string, unknown>>(
    documentType: string,
    chain: MigrationChain<TSystem>,
  ): { ok: true } | { ok: false; reason: string };
}

export interface BlockedDoc {
  docId: string;
  docType: string;
  prevVersion: number;
  createdAt: number;
}

export type MigrationResult =
  | { ok: true; fromVersion: number; toVersion: number }
  | { ok: false; atFrom: number; atTo: number; error: string };

//  Narrow admin surface for the /migrations command. Lives on the
// frozen ServerExtensionAPI so the builtin can recover blocked docs
// without reaching into host internals (db, registry, lock). The host
// owns the implementation; the extension only sees an ok/result contract.
export interface MigrationsAPI {
  listBlocked(): Promise<BlockedDoc[]>;
  retry(docId: string): Promise<MigrationResult>;
  // GM recovery path: substitute the result of a broken step. The chain
  // continues from there; skipSteps names the `from` versions that should
  // be skipped (their `up` result is replaced by `systemOverride`).
  review(
    docId: string,
    patch: { skipSteps: number[]; systemOverride?: unknown },
  ): Promise<MigrationResult>;
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
  // These return void by design — the API does not expose unsub handles.
  // To stop receiving an event, call `api.hooks.off(event, handler)` with
  // the same handler reference. Keeping the return void prevents extensions
  // from accumulating unsub closures they forget to call.
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
  migrations: MigrationsAPI;
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
    //  Accessors are skipped on purpose. Reading one would RUN it, and the
    //  result would then be frozen — for `api.canvas.viewport` that meant
    //  freezing Pixi's whole reachable object graph (breaking the renderer, not
    //  protecting anything). Skipping does not open an assignment path: the
    //  getter is an accessor with no setter, so writes already threw under the
    //  strict mode ESM always runs in.
    const desc = Object.getOwnPropertyDescriptor(obj, name);
    if (desc?.get) continue;
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