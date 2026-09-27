import type { ComponentType } from "preact";
import type { Document, HooksAPI } from "@rollforge/protocol";

export interface ClientDocumentsAPI {
  get<T extends Document = Document>(id: string): T | null;
  subscribe<T extends Document = Document>(id: string, fn: (doc: T) => void): () => void;
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

export function freezeClientAPI(api: ClientExtensionAPI): ClientExtensionAPI {
  return Object.freeze(api);
}