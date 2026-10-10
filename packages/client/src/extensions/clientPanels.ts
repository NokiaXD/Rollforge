import { signal } from "@preact/signals";
import type { Document } from "@rollforge/protocol";
import type { ClientExtensionAPI, ClientPanelRegistration } from "@rollforge/extension-api";
import { fetchDocuments, listDocumentsByType } from "../state/documents";

export interface CorePanelExtra {
  requiresGm?: boolean;
}

export interface ClientPanelEntry {
  panel: ClientPanelRegistration & CorePanelExtra;
  api: ClientExtensionAPI;
  extensionId: string;
}

const panels = signal<readonly ClientPanelEntry[]>([]);

export const CORE_PANEL_IDS: ReadonlySet<string> = new Set(["scenes", "tokens", "chat"]);
const CORE_ORDER: readonly string[] = ["scenes", "tokens", "chat"];

export function registerCorePanel(entry: ClientPanelEntry): void {
  const existingIdx = panels.value.findIndex((p) => p.panel.id === entry.panel.id);
  if (existingIdx >= 0) {
    panels.value = panels.value.map((p, i) => (i === existingIdx ? entry : p));
  } else {
    panels.value = [...panels.value, entry];
  }
}

export function registerPanel(
  entry: ClientPanelEntry,
  onError?: (message: string) => void,
): void {
  if (CORE_PANEL_IDS.has(entry.panel.id) || entry.extensionId === "core") {
    onError?.(
      `[panels] panel id "${entry.panel.id}" collides with a core sidebar tab; not registered`,
    );
    return;
  }
  const existingIdx = panels.value.findIndex((p) => p.panel.id === entry.panel.id);
  if (existingIdx >= 0) {
    onError?.(
      `[panels] panel id "${entry.panel.id}" was already registered by "${panels.value[existingIdx]!.extensionId}"; replacing it with "${entry.extensionId}"`,
    );
    panels.value = panels.value.map((p, i) => (i === existingIdx ? entry : p));
  } else {
    panels.value = [...panels.value, entry];
  }
  for (const type of entry.panel.documentTypes ?? []) {
    void fetchDocuments(type).catch(() => {});
  }
}

export function panelFor(id: string): ClientPanelEntry | undefined {
  return panels.value.find((p) => p.panel.id === id);
}

export function listPanels(): readonly ClientPanelEntry[] {
  const list = [...panels.value];
  return list.sort((a, b) => {
    const aCore = CORE_ORDER.indexOf(a.panel.id);
    const bCore = CORE_ORDER.indexOf(b.panel.id);
    if (aCore >= 0 && bCore >= 0) return aCore - bCore;
    if (aCore >= 0) return -1;
    if (bCore >= 0) return 1;
    return a.panel.id.localeCompare(b.panel.id);
  });
}

export function panelEntries(panel: ClientPanelRegistration): readonly Document[] {
  const out: Document[] = [];
  for (const type of panel.documentTypes ?? []) out.push(...listDocumentsByType(type));
  return out;
}

export function clearPanelsFor(extensionId: string): void {
  panels.value = panels.value.filter((p) => p.extensionId !== extensionId);
}

export function clearPanels(): void {
  panels.value = [];
}
