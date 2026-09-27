import type { Document, HooksAPI } from "@rollforge/protocol";

export interface DocumentsAPI {
  get<T extends Document = Document>(id: string): Promise<T | null>;
  create<T extends Document>(input: Omit<T, "_rev">): Promise<T>;
  update<T extends Document>(id: string, patch: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
}

export interface ChatAPI {
  send(message: string, opts?: { whisperTo?: string }): Promise<void>;
  registerCommand(cmd: {
    name: string;
    description: string;
    handler: (args: string[], ctx: { userId: string }) => void | Promise<void>;
  }): void;
}

export interface DiceAPI {
  roll(notation: string): { total: number; rolls: number[] };
}

export interface ServerExtensionContext {
  userId: string;
  isGM: boolean;
}

export interface ServerExtensionAPI {
  documents: DocumentsAPI;
  hooks: HooksAPI;
  chat: ChatAPI;
  dice: DiceAPI;
  context: ServerExtensionContext;
}

export function freezeServerAPI(api: ServerExtensionAPI): ServerExtensionAPI {
  return Object.freeze(api);
}