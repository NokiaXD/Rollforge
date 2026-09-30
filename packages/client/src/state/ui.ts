import { signal } from "@preact/signals";

export type SidebarTab = "scenes" | "tokens";

export const activeSidebarTab = signal<SidebarTab | null>("scenes");
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
