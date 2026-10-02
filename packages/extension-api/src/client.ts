import type { ComponentType } from "preact";
import type { Document, HooksAPI } from "@rollforge/protocol";
import type { DocumentUpdateRejection } from "./errors";
import { deepFreeze } from "./server";

export interface ClientDocumentsAPI {
  get<T extends Document = Document>(id: string): T | null;
  subscribe<T extends Document = Document>(id: string, fn: (doc: T) => void): () => void;
  //  Paso 16 — typed write surface. Rejects with DocumentUpdateRejection;
  // `.reason` discriminates between forbidden / stale-rev / migration-blocked /
  // extension-not-ready / not-found / network-error. bootstrap.ts owns the
  // HTTP translation table (§4 of plan-paso-16.md).
  update<T extends Document = Document>(id: string, patch: Partial<T>): Promise<T>;
}

export interface ClientUIAPI {
  registerSheet(opts: {
    documentType: string;
    component: ComponentType<{ documentId: string }>;
    default?: boolean;
  }): void;
  notify(message: string): void;
}

export interface ClientExtensionContext {
  userId: string;
  sceneId: string | null;
}

export interface ClientExtensionAPI {
  documents: ClientDocumentsAPI;
  hooks: HooksAPI;
  ui: ClientUIAPI;
  context: ClientExtensionContext;
}

//  re-exported so clients don't need a second import line.
export { deepFreeze } from "./server";

export function freezeClientAPI(api: ClientExtensionAPI): ClientExtensionAPI {
  return deepFreeze(api);
}

export type { DocumentUpdateRejection };
