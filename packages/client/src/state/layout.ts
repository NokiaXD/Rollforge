import { signal, computed, effect } from "@preact/signals";
import {
  computeEffectiveSidebarWidths,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  RESIZE_ACTIVE_THRESHOLD,
} from "../ui/layout/sidebarResize";
import { currentUser } from "./auth";
import { listPanels } from "../extensions/clientPanels";
import {
  effectiveActiveTab,
  movePanelDock,
  popOutPanel,
  dockFloatingPanel,
  reconcileSavedLayout,
  CURRENT_LAYOUT_VERSION,
  type LayoutStateData,
  type PanelDock,
} from "./layoutTransitions";
import { loadUserLayout, saveUserLayout } from "./layoutStorage";
import { openWindow, closeWindow, windowFocusOrder } from "./ui";

const DEFAULT_PANEL_DOCKS: Record<string, PanelDock> = {
  scenes: "left",
  tokens: "left",
  chat: "right",
};

export const preferredLeftSidebarWidth = signal<number>(DEFAULT_SIDEBAR_WIDTH);
export const preferredRightSidebarWidth = signal<number>(DEFAULT_SIDEBAR_WIDTH);

export const leftSidebarOpen = signal<boolean>(true);
export const rightSidebarOpen = signal<boolean>(true);

export const panelDocks = signal<Record<string, PanelDock>>({ ...DEFAULT_PANEL_DOCKS });

export const floatingPanels = signal<string[]>([]);

/** Floating panels collapsed to just their header. */
export const collapsedPanels = signal<string[]>([]);

export const activeLeftTab = signal<string | null>("scenes");
export const activeRightTab = signal<string | null>("chat");

export const viewportWidth = signal<number>(
  typeof window !== "undefined" ? window.innerWidth : 1200,
);

if (typeof window !== "undefined") {
  window.addEventListener("resize", () => {
    viewportWidth.value = window.innerWidth;
  });
}

/**
 * Pop-out is enabled only when viewport is at or above RESIZE_ACTIVE_THRESHOLD.
 */
export const canPopOut = computed(() => viewportWidth.value >= RESIZE_ACTIVE_THRESHOLD);

/**
 * In narrow viewports (< 720px), all panels are treated as docked (empty floating list).
 */
export const effectiveFloatingPanels = computed(() => {
  return canPopOut.value ? floatingPanels.value : [];
});

/**
 * Panels visible for the current user's role (filtering out GM-only panels for players).
 */
export const visiblePanels = computed(() => {
  const isGM = currentUser.value?.role === "GM";
  return listPanels().filter((p) => {
    if (p.panel.requiresGm && !isGM) return false;
    return true;
  });
});

export const visiblePanelIds = computed(() => {
  return visiblePanels.value.map((p) => p.panel.id);
});

/**
 * Floating panels that are actually painted (registered, permitted by role, and viewport >= 720px).
 */
export const renderedFloatingPanelIds = computed(() => {
  if (!canPopOut.value) return [];
  const isGM = currentUser.value?.role === "GM";
  const panels = listPanels();
  return floatingPanels.value.filter((id) => {
    const entry = panels.find((p) => p.panel.id === id);
    if (!entry) return false;
    if (entry.panel.requiresGm && !isGM) return false;
    return true;
  });
});

export const effectiveLeftTab = computed(() => {
  return effectiveActiveTab(
    panelDocks.value,
    activeLeftTab.value,
    visiblePanelIds.value,
    "left",
    effectiveFloatingPanels.value,
  );
});

export const effectiveRightTab = computed(() => {
  return effectiveActiveTab(
    panelDocks.value,
    activeRightTab.value,
    visiblePanelIds.value,
    "right",
    effectiveFloatingPanels.value,
  );
});

/**
 * A sidebar is effectively open only if the user hasn't collapsed it AND it has visible docked panels.
 */
export const isLeftSidebarEffectiveOpen = computed(() => {
  return leftSidebarOpen.value && effectiveLeftTab.value !== null;
});

export const isRightSidebarEffectiveOpen = computed(() => {
  return rightSidebarOpen.value && effectiveRightTab.value !== null;
});

export const effectiveSidebarWidths = computed(() => {
  return computeEffectiveSidebarWidths({
    preferredLeft: preferredLeftSidebarWidth.value,
    preferredRight: preferredRightSidebarWidth.value,
    viewportWidth: viewportWidth.value,
    leftOpen: isLeftSidebarEffectiveOpen.value,
    rightOpen: isRightSidebarEffectiveOpen.value,
  });
});

function persistCurrentLayout(): void {
  const userId = currentUser.value?.id;
  if (!userId) return;

  const data: LayoutStateData = {
    version: CURRENT_LAYOUT_VERSION,
    preferredLeftWidth: preferredLeftSidebarWidth.value,
    preferredRightWidth: preferredRightSidebarWidth.value,
    leftOpen: leftSidebarOpen.value,
    rightOpen: rightSidebarOpen.value,
    panelDocks: { ...panelDocks.value },
    activeLeftTab: activeLeftTab.value,
    activeRightTab: activeRightTab.value,
    floatingPanels: [...floatingPanels.value],
    collapsedPanels: [...collapsedPanels.value],
  };
  saveUserLayout(userId, data);
}

// Prune unrendered panel keys from windowFocusOrder
effect(() => {
  const renderedSet = new Set(renderedFloatingPanelIds.value.map((id) => `panel:${id}`));
  const current = windowFocusOrder.value;
  const filtered = current.filter((key) => {
    if (key.startsWith("panel:")) {
      return renderedSet.has(key);
    }
    return true;
  });
  if (filtered.length !== current.length) {
    windowFocusOrder.value = filtered;
  }
});

// Reconcile and load saved layout when user logs in / session resolves
let lastLoadedUserId: string | null = null;
effect(() => {
  const user = currentUser.value;
  const userId = user?.id ?? null;
  if (userId && userId !== lastLoadedUserId) {
    lastLoadedUserId = userId;
    const saved = loadUserLayout(userId);
    if (saved) {
      const allRegisteredIds = listPanels().map((p) => p.panel.id);
      const reconciled = reconcileSavedLayout(
        saved,
        allRegisteredIds,
        visiblePanelIds.value,
        DEFAULT_PANEL_DOCKS,
      );
      preferredLeftSidebarWidth.value = reconciled.preferredLeftWidth;
      preferredRightSidebarWidth.value = reconciled.preferredRightWidth;
      leftSidebarOpen.value = reconciled.leftOpen;
      rightSidebarOpen.value = reconciled.rightOpen;
      panelDocks.value = reconciled.panelDocks;
      floatingPanels.value = reconciled.floatingPanels;
      collapsedPanels.value = reconciled.collapsedPanels ?? [];
      activeLeftTab.value = reconciled.activeLeftTab;
      activeRightTab.value = reconciled.activeRightTab;
      for (const fId of reconciled.floatingPanels) {
        if (viewportWidth.value >= RESIZE_ACTIVE_THRESHOLD) {
          openWindow(`panel:${fId}`);
        }
      }
    }
  } else if (!userId) {
    lastLoadedUserId = null;
  }
});

export function setPreferredLeftSidebarWidth(width: number): void {
  preferredLeftSidebarWidth.value = Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(width, MAX_SIDEBAR_WIDTH),
  );
  persistCurrentLayout();
}

export function setPreferredRightSidebarWidth(width: number): void {
  preferredRightSidebarWidth.value = Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(width, MAX_SIDEBAR_WIDTH),
  );
  persistCurrentLayout();
}

export function resetLeftSidebarWidth(): void {
  preferredLeftSidebarWidth.value = DEFAULT_SIDEBAR_WIDTH;
  persistCurrentLayout();
}

export function resetRightSidebarWidth(): void {
  preferredRightSidebarWidth.value = DEFAULT_SIDEBAR_WIDTH;
  persistCurrentLayout();
}

export function toggleLeftSidebar(): void {
  leftSidebarOpen.value = !leftSidebarOpen.value;
  persistCurrentLayout();
}

export function toggleRightSidebar(): void {
  rightSidebarOpen.value = !rightSidebarOpen.value;
  persistCurrentLayout();
}

export function selectLeftTab(id: string): void {
  if (activeLeftTab.value === id && leftSidebarOpen.value) {
    leftSidebarOpen.value = false;
  } else {
    activeLeftTab.value = id;
    leftSidebarOpen.value = true;
  }
  persistCurrentLayout();
}

export function selectRightTab(id: string): void {
  if (activeRightTab.value === id && rightSidebarOpen.value) {
    rightSidebarOpen.value = false;
  } else {
    activeRightTab.value = id;
    rightSidebarOpen.value = true;
  }
  persistCurrentLayout();
}

export function toggleCollapse(panelId: string): void {
  collapsedPanels.value = collapsedPanels.value.includes(panelId)
    ? collapsedPanels.value.filter((id) => id !== panelId)
    : [...collapsedPanels.value, panelId];
  persistCurrentLayout();
}

export function movePanel(panelId: string, targetDock: PanelDock): void {
  const current: LayoutStateData = {
    version: CURRENT_LAYOUT_VERSION,
    preferredLeftWidth: preferredLeftSidebarWidth.value,
    preferredRightWidth: preferredRightSidebarWidth.value,
    leftOpen: leftSidebarOpen.value,
    rightOpen: rightSidebarOpen.value,
    panelDocks: { ...panelDocks.value },
    activeLeftTab: activeLeftTab.value,
    activeRightTab: activeRightTab.value,
    floatingPanels: [...floatingPanels.value],
  };

  const next = movePanelDock(current, panelId, targetDock, visiblePanelIds.value);
  panelDocks.value = next.panelDocks;
  floatingPanels.value = next.floatingPanels;
  leftSidebarOpen.value = next.leftOpen;
  rightSidebarOpen.value = next.rightOpen;
  activeLeftTab.value = next.activeLeftTab;
  activeRightTab.value = next.activeRightTab;

  persistCurrentLayout();
}

export function popOut(panelId: string): void {
  const current: LayoutStateData = {
    version: CURRENT_LAYOUT_VERSION,
    preferredLeftWidth: preferredLeftSidebarWidth.value,
    preferredRightWidth: preferredRightSidebarWidth.value,
    leftOpen: leftSidebarOpen.value,
    rightOpen: rightSidebarOpen.value,
    panelDocks: { ...panelDocks.value },
    activeLeftTab: activeLeftTab.value,
    activeRightTab: activeRightTab.value,
    floatingPanels: [...floatingPanels.value],
  };

  const next = popOutPanel(current, panelId, visiblePanelIds.value);
  floatingPanels.value = next.floatingPanels;
  panelDocks.value = next.panelDocks;
  leftSidebarOpen.value = next.leftOpen;
  rightSidebarOpen.value = next.rightOpen;
  activeLeftTab.value = next.activeLeftTab;
  activeRightTab.value = next.activeRightTab;

  openWindow(`panel:${panelId}`);
  persistCurrentLayout();
}

export function dockFloating(panelId: string, targetDock: PanelDock): void {
  const current: LayoutStateData = {
    version: CURRENT_LAYOUT_VERSION,
    preferredLeftWidth: preferredLeftSidebarWidth.value,
    preferredRightWidth: preferredRightSidebarWidth.value,
    leftOpen: leftSidebarOpen.value,
    rightOpen: rightSidebarOpen.value,
    panelDocks: { ...panelDocks.value },
    activeLeftTab: activeLeftTab.value,
    activeRightTab: activeRightTab.value,
    floatingPanels: [...floatingPanels.value],
  };

  const next = dockFloatingPanel(current, panelId, targetDock, visiblePanelIds.value);
  floatingPanels.value = next.floatingPanels;
  panelDocks.value = next.panelDocks;
  leftSidebarOpen.value = next.leftOpen;
  rightSidebarOpen.value = next.rightOpen;
  activeLeftTab.value = next.activeLeftTab;
  activeRightTab.value = next.activeRightTab;

  closeWindow(`panel:${panelId}`);
  persistCurrentLayout();
}

export function closeFloatingPanel(panelId: string): void {
  const origin = panelDocks.value[panelId] ?? "left";
  dockFloating(panelId, origin);
}
