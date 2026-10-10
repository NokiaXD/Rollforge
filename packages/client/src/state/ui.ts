import { signal, computed } from "@preact/signals";

//  Core tabs are a fixed union; extension panels (Paso 18's
//  api.ui.registerPanel) add their own ids at runtime, so the tab is just a
//  string. The core views are matched by their literal ids; anything else is
//  looked up in the panel registry.
export type CoreSidebarTab = "scenes" | "tokens";
export type SidebarTab = CoreSidebarTab | (string & {});

import {
  openWindowState,
  closeWindowState,
  focusWindowState,
} from "../ui/windowFrameUtils";

export const activeSidebarTab = signal<SidebarTab | null>("scenes");
export const windowFocusOrder = signal<string[]>([]);

export const openDocuments = computed<string[]>(() => {
  return windowFocusOrder.value
    .filter((k) => k.startsWith("doc:"))
    .map((k) => k.slice(4));
});

export const activeDocument = computed<string | null>(() => {
  const docs = windowFocusOrder.value.filter((k) => k.startsWith("doc:"));
  return docs.length > 0 ? docs[docs.length - 1]!.slice(4) : null;
});

export function openDocument(id: string): void {
  windowFocusOrder.value = openWindowState(windowFocusOrder.value, `doc:${id}`);
}

export function closeDocument(id: string): void {
  windowFocusOrder.value = closeWindowState(windowFocusOrder.value, `doc:${id}`);
}

export function focusDocument(id: string): void {
  windowFocusOrder.value = focusWindowState(windowFocusOrder.value, `doc:${id}`);
}

export function openWindow(key: string): void {
  windowFocusOrder.value = openWindowState(windowFocusOrder.value, key);
}

export function closeWindow(key: string): void {
  windowFocusOrder.value = closeWindowState(windowFocusOrder.value, key);
}

export function focusWindow(key: string): void {
  windowFocusOrder.value = focusWindowState(windowFocusOrder.value, key);
}

export const gmUsersModalOpen = signal<boolean>(false);
export const settingsModalOpen = signal<boolean>(false);

export type SceneFormContext =
  | { mode: "create"; folderId?: string | null }
  | { mode: "edit"; sceneId: string };

export const sceneFormModal = signal<SceneFormContext | null>(null);

export type FolderFormContext = { folderId: string };

export const folderFormModal = signal<FolderFormContext | null>(null);

export const folderDeleteConfirm = signal<string | null>(null);

export type ContextMenuItem = {
  label?: string;
  onClick?: () => void;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
};

export type ContextMenuState = {
  x: number;
  y: number;
  items: ContextMenuItem[];
};

export const contextMenu = signal<ContextMenuState | null>(null);

export function openContextMenu(
  e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void },
  items: ContextMenuItem[]
): void {
  e.preventDefault?.();
  e.stopPropagation?.();
  contextMenu.value = { x: e.clientX, y: e.clientY, items };
}

export function toggleSidebar(tab: SidebarTab) {
  if (activeSidebarTab.value === tab) {
    activeSidebarTab.value = null;
  } else {
    activeSidebarTab.value = tab;
  }
}

export function openSidebar(tab: SidebarTab) {
  activeSidebarTab.value = tab;
}

export function closeSidebar() {
  activeSidebarTab.value = null;
}
