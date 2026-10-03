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
  //  Paso 18 — list by type, from the same signal store `get` reads. The
  //  missing counterpart to the server's DocumentsAPI (which also had no
  //  list until a consumer needed one): an extension cannot show a browser
  //  over its own documents without it, because it has no HTTP client of
  //  its own. Read-through only; registering a panel with documentTypes
  //  makes the host prefetch, so this is a synchronous read once loaded.
  list<T extends Document = Document>(type: string): readonly T[];
}

//  A sidebar panel. `entries` is resolved by the HOST from the
//  documentTypes the panel declared, so the component stays a pure renderer
//  and never has to know about fetch or the signal store.
export interface ClientPanelProps {
  api: ClientExtensionAPI;
  entries: readonly Document[];
}

export interface ClientPanelRegistration {
  //  becomes a SidebarTab id, so it must be unique across extensions.
  id: string;
  title: string;
  //  Material Design PUA codepoint, same convention as the core ActivityBar.
  //  Optional: the host falls back to a neutral glyph.
  icon?: string;
  component: ComponentType<ClientPanelProps>;
  //  documentTypes whose documents the host should load before mounting the
  //  panel, and whose documents are then handed to it as `entries`.
  documentTypes?: string[];
}

export interface ClientUIAPI {
  registerSheet(opts: {
    documentType: string;
    component: ComponentType<{ documentId: string }>;
    default?: boolean;
  }): void;
  //  Paso 18 — the first extension-owned surface that is not a modal sheet.
  //  Before this, an extension could only contribute something the user had
  //  to already have a document id for, so "a browser over a collection"
  //  (compendia, Paso 19's macro list, Paso 20's item list) had no home and
  //  would have forced either a core-specific tab or a sheet abused as a
  //  panel. Semver: additive, and it opens the door for the later steps.
  registerPanel(opts: ClientPanelRegistration): void;
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
