import { signal } from "@preact/signals";

//  Core tabs are a fixed union; extension panels (Paso 18's
//  api.ui.registerPanel) add their own ids at runtime, so the tab is just a
//  string. The core views are matched by their literal ids; anything else is
//  looked up in the panel registry.
export type CoreSidebarTab = "scenes" | "tokens" | "actors";
export type SidebarTab = CoreSidebarTab | (string & {});

export const activeSidebarTab = signal<SidebarTab | null>("scenes");
export const openDocument = signal<string | null>(null);
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
