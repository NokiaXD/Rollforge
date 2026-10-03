import type { Document } from "@rollforge/protocol";
import type { ClientExtensionAPI, ClientPanelRegistration } from "@rollforge/extension-api";
import { fetchDocuments, listDocumentsByType } from "../state/documents";

//  Client-side panel registry — the mirror of clientSheets.ts, for the
//  Paso 18 `api.ui.registerPanel` surface. An extension contributes a panel,
//  the host mounts it in the Sidebar when the tab is active.
//
//  One difference from sheets: the host owns `entries`. The panel declares
//  which documentTypes it browses and the host prefetches them and hands the
//  resulting documents over as props. A client extension has no HTTP client
//  and cannot import the client's signal store (it is served raw and its only
//  resolvable specifiers are the import map), so without this a panel would
//  have to be handed a callback per row or reimplement fetching.

export interface ClientPanelEntry {
  panel: ClientPanelRegistration;
  //  the api instance the panel was registered with, so the component it
  //  renders can be handed the same scoped api the extension captured.
  api: ClientExtensionAPI;
  extensionId: string;
}

const panels: ClientPanelEntry[] = [];

//  Sidebar mounts a core view and an extension panel by matching the same
//  `tab` id, so a panel that shadows a core tab would render stacked on top
//  of it. Refuse the registration instead — the core tab wins, because the
//  user asked for that tab by clicking the core icon.
const CORE_TAB_IDS: ReadonlySet<string> = new Set(["scenes", "tokens", "actors"]);

export function registerPanel(
  entry: ClientPanelEntry,
  onError?: (message: string) => void,
): void {
  if (CORE_TAB_IDS.has(entry.panel.id)) {
    onError?.(
      `[panels] panel id "${entry.panel.id}" collides with a core sidebar tab; not registered`,
    );
    return;
  }
  const existingIdx = panels.findIndex((p) => p.panel.id === entry.panel.id);
  if (existingIdx >= 0) {
    // Last registration wins for the same id. Unlike sheets there is no
    // ownership to reconcile: a panel id is a tab, and re-registering the
    // same tab is what an HMR reload does. Log it rather than throwing —
    // a client-side hiccup must not take down the app shell.
    onError?.(
      `[panels] panel id "${entry.panel.id}" was already registered by "${panels[existingIdx]!.extensionId}"; replacing it with "${entry.extensionId}"`,
    );
    panels[existingIdx] = entry;
  } else {
    panels.push(entry);
  }
  for (const type of entry.panel.documentTypes ?? []) {
    //  Fire-and-forget prefetch, deliberately swallowing the failure: this
    //  runs while the panel registers, not while the user is looking at it,
    //  so a rejected promise here would be an unhandled rejection with no UI
    //  to report it into. The panel simply renders empty and the socket
    //  broadcast fills it in once the server is reachable.
    void fetchDocuments(type).catch(() => {});
  }
}

export function panelFor(id: string): ClientPanelEntry | undefined {
  return panels.find((p) => p.panel.id === id);
}

export function listPanels(): readonly ClientPanelEntry[] {
  return panels;
}

//  Documents for the panel's declared types, flattened. Reads the
//  `documents` signal through listDocumentsByType, so mounting inside a
//  component subscribes to it: the panel re-renders when a document of those
//  types arrives (e.g. the socket broadcast after a GM loads a pack).
export function panelEntries(panel: ClientPanelRegistration): readonly Document[] {
  const out: Document[] = [];
  for (const type of panel.documentTypes ?? []) out.push(...listDocumentsByType(type));
  return out;
}

export function clearPanelsFor(extensionId: string): void {
  for (let i = panels.length - 1; i >= 0; i--) {
    if (panels[i]!.extensionId === extensionId) panels.splice(i, 1);
  }
}

export function clearPanels(): void {
  panels.length = 0;
}
