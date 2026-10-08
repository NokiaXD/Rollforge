import type { ComponentType, h as PreactH } from "preact";
import type { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
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
  //  The host's OWN preact, handed over for the same reason as
  //  `api.canvas.pixi`: a raw-served extension file must not `import "preact"`.
  //  The import map only exists under the Vite dev server, and even there
  //  "preact" resolves to the optimizer's UNVERSIONED url while the app imports
  //  the same file as `preact.js?v=<hash>` — two module instances, so the
  //  extension's hooks are wired to a preact that never renders and every
  //  useState() throws "Cannot read properties of undefined (reading '__H')".
  //  With no import map at all (client built, served by Express) the import
  //  does not resolve. One preact, the host's.
  preact: ClientPreactAPI;
}

export interface ClientPreactAPI {
  h: typeof PreactH;
  useState: typeof useState;
  useRef: typeof useRef;
  useEffect: typeof useEffect;
  useMemo: typeof useMemo;
  useCallback: typeof useCallback;
}

export interface ClientExtensionContext {
  userId: string;
  sceneId: string | null;
}

//  Paso 24 — the drawing surface. This is the ONE documented exception to
//  "extensions never touch core internals" (sistema.md §4): a client extension
//  that draws on the map is coupled to whatever renderer the core uses. It is
//  typed structurally (no pixi dependency here) and the classes are handed over
//  rather than imported, because the raw-served client file can only resolve
//  what the import map covers — and that map only exists under the Vite dev
//  server, so `import "pixi.js"` from an extension breaks on a build served by
//  Express. Revisit when a second extension actually draws something.
export interface ClientViewportEvent {
  //  screen px; use `toWorld` to get world coordinates.
  global: { x: number; y: number };
  //  0 left, 1 middle, 2 right.
  button: number;
}

export interface ClientViewportLike {
  toWorld(p: { x: number; y: number }): { x: number; y: number };
  addChild(child: unknown): unknown;
  //  `off` and `removeChild` are here because teardown is the extension's
  //  responsibility: nothing in the core knows what an extension attached, and
  //  onReady can hand it a new viewport while the old one is being destroyed.
  off(event: string, fn: (e: ClientViewportEvent) => void): void;
  removeChild(child: unknown): unknown;
  on(event: string, fn: (e: ClientViewportEvent) => void): void;
}

export interface ClientCanvasAPI {
  //  Live viewport, or null before the canvas mounts. It is a getter on purpose:
  //  extensions activate before ui/App.tsx creates Pixi, so a captured value
  //  would be permanently null. Read-only by construction (accessor with no
  //  setter) — deepFreeze skips accessors, see server.ts.
  readonly viewport: ClientViewportLike | null;
  readonly pixi: { Container: unknown; Graphics: unknown; Text: unknown };
  //  Fires for EVERY viewport, not once: ui/App.tsx is HMR'd in development, and
  //  that recreates Pixi from scratch, orphaning anything attached to the old
  //  viewport. Extensions must tear down their previous attachment first.
  onReady(cb: (viewport: ClientViewportLike) => void): void;
}

export interface ClientSceneToken {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

//  Plain getters, not signals: the raw-served extension file cannot import
//  @preact/signals either. Always fresh on call, so an overlay that redraws on
//  its own events (which is when the scale actually matters) never reads stale.
export interface ClientSceneAPI {
  cellSize(): number;
  //  Real length of one grid cell, in `units`. Falls back to 5.
  cellLength(): number;
  units(): "ft" | "m";
  //  Token centers in world px, so a tool can anchor to the token's middle
  //  rather than to the pixel that was grabbed.
  tokens(): readonly ClientSceneToken[];
}

export interface ClientExtensionAPI {
  documents: ClientDocumentsAPI;
  hooks: HooksAPI;
  ui: ClientUIAPI;
  context: ClientExtensionContext;
  canvas: ClientCanvasAPI;
  scene: ClientSceneAPI;
}

//  re-exported so clients don't need a second import line.
export { deepFreeze } from "./server";

export function freezeClientAPI(api: ClientExtensionAPI): ClientExtensionAPI {
  return deepFreeze(api);
}

export type { DocumentUpdateRejection };
