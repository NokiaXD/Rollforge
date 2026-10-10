import type { ChatMessageEvent } from "@rollforge/protocol";

export type PanelDock = "left" | "right";

export interface LayoutStateData {
  version: 1;
  preferredLeftWidth: number;
  preferredRightWidth: number;
  leftOpen: boolean;
  rightOpen: boolean;
  panelDocks: Record<string, PanelDock>;
  activeLeftTab: string | null;
  activeRightTab: string | null;
  floatingPanels: string[];
}

export interface PanelMeta {
  id: string;
  title: string;
  icon: string;
  requiresGm?: boolean;
}

export const CURRENT_LAYOUT_VERSION = 1;

/**
 * Returns the effective active tab for a given side.
 * - Only considers panels that are NOT floating.
 * - If the currently active tab is among the visible docked IDs on that side, returns it.
 * - Otherwise, returns the first visible docked ID on that side.
 * - If no panels are visible on that side, returns null.
 */
export function effectiveActiveTab(
  panelDocks: Record<string, PanelDock>,
  currentActive: string | null,
  visibleIds: readonly string[],
  side: PanelDock,
  floatingPanels: readonly string[] = [],
): string | null {
  const visibleOnSide = visibleIds.filter(
    (id) => (panelDocks[id] ?? "left") === side && !floatingPanels.includes(id),
  );
  if (visibleOnSide.length === 0) return null;
  if (currentActive && visibleOnSide.includes(currentActive)) {
    return currentActive;
  }
  return visibleOnSide[0] ?? null;
}

/**
 * Moves a docked panel from its current dock to targetDock.
 * - Target side opens automatically.
 * - The moved panel becomes active on the target side.
 * - If it was active on the origin side, the origin side re-elects its first available visible panel (or null).
 */
export function movePanelDock(
  current: LayoutStateData,
  panelId: string,
  targetDock: PanelDock,
  visibleIds: readonly string[],
): LayoutStateData {
  const floating = current.floatingPanels ?? [];
  const originDock = current.panelDocks[panelId] ?? (targetDock === "left" ? "right" : "left");
  if (originDock === targetDock && !floating.includes(panelId)) {
    return current;
  }

  const nextDocks = {
    ...current.panelDocks,
    [panelId]: targetDock,
  };
  const nextFloating = floating.filter((id) => id !== panelId);

  let nextActiveLeft = current.activeLeftTab;
  let nextActiveRight = current.activeRightTab;
  let nextLeftOpen = current.leftOpen;
  let nextRightOpen = current.rightOpen;

  if (targetDock === "left") {
    nextLeftOpen = true;
    nextActiveLeft = panelId;
    if (current.activeRightTab === panelId) {
      nextActiveRight = effectiveActiveTab(nextDocks, null, visibleIds, "right", nextFloating);
      if (!nextActiveRight) nextRightOpen = false;
    }
  } else {
    nextRightOpen = true;
    nextActiveRight = panelId;
    if (current.activeLeftTab === panelId) {
      nextActiveLeft = effectiveActiveTab(nextDocks, null, visibleIds, "left", nextFloating);
      if (!nextActiveLeft) nextLeftOpen = false;
    }
  }

  return {
    ...current,
    panelDocks: nextDocks,
    floatingPanels: nextFloating,
    leftOpen: nextLeftOpen,
    rightOpen: nextRightOpen,
    activeLeftTab: nextActiveLeft,
    activeRightTab: nextActiveRight,
  };
}

/**
 * Pops out a panel into floating mode.
 * - Adds panelId to floatingPanels.
 * - Re-elects active tab for the origin sidebar (or closes it if empty).
 */
export function popOutPanel(
  current: LayoutStateData,
  panelId: string,
  visibleIds: readonly string[],
): LayoutStateData {
  const floating = current.floatingPanels ?? [];
  if (floating.includes(panelId)) return current;

  const nextFloating = [...floating, panelId];
  const originDock = current.panelDocks[panelId] ?? "left";

  let nextActiveLeft = current.activeLeftTab;
  let nextActiveRight = current.activeRightTab;
  let nextLeftOpen = current.leftOpen;
  let nextRightOpen = current.rightOpen;

  if (originDock === "left") {
    if (current.activeLeftTab === panelId) {
      nextActiveLeft = effectiveActiveTab(
        current.panelDocks,
        null,
        visibleIds,
        "left",
        nextFloating,
      );
      if (!nextActiveLeft) nextLeftOpen = false;
    }
  } else {
    if (current.activeRightTab === panelId) {
      nextActiveRight = effectiveActiveTab(
        current.panelDocks,
        null,
        visibleIds,
        "right",
        nextFloating,
      );
      if (!nextActiveRight) nextRightOpen = false;
    }
  }

  return {
    ...current,
    floatingPanels: nextFloating,
    activeLeftTab: nextActiveLeft,
    activeRightTab: nextActiveRight,
    leftOpen: nextLeftOpen,
    rightOpen: nextRightOpen,
  };
}

/**
 * Docks a floating panel back into a sidebar (targetDock).
 * - Removes panelId from floatingPanels.
 * - Opens target sidebar and activates the panel.
 */
export function dockFloatingPanel(
  current: LayoutStateData,
  panelId: string,
  targetDock: PanelDock,
  visibleIds: readonly string[],
): LayoutStateData {
  const floating = (current.floatingPanels ?? []).filter((id) => id !== panelId);
  const nextDocks = { ...current.panelDocks, [panelId]: targetDock };

  let nextActiveLeft = current.activeLeftTab;
  let nextActiveRight = current.activeRightTab;
  let nextLeftOpen = current.leftOpen;
  let nextRightOpen = current.rightOpen;

  if (targetDock === "left") {
    nextLeftOpen = true;
    nextActiveLeft = panelId;
  } else {
    nextRightOpen = true;
    nextActiveRight = panelId;
  }

  return {
    ...current,
    panelDocks: nextDocks,
    floatingPanels: floating,
    leftOpen: nextLeftOpen,
    rightOpen: nextRightOpen,
    activeLeftTab: nextActiveLeft,
    activeRightTab: nextActiveRight,
  };
}

/**
 * Closes a floating panel by returning it to its origin dock.
 */
export function closeFloating(
  current: LayoutStateData,
  panelId: string,
  visibleIds: readonly string[],
): LayoutStateData {
  const originDock = current.panelDocks[panelId] ?? "left";
  return dockFloatingPanel(current, panelId, originDock, visibleIds);
}

/**
 * Reconciles saved layout state with currently registered panels:
 * - Unknown IDs are PRESERVED in docks and floatingPanels (e.g. extension failed to load).
 * - New panels are placed in default dock ("left") WITHOUT stealing active tab.
 * - Active tabs are re-validated against visible docked IDs.
 */
export function reconcileSavedLayout(
  saved: LayoutStateData,
  currentRegisteredIds: readonly string[],
  visibleIds: readonly string[],
  defaultDocks: Record<string, PanelDock>,
): LayoutStateData {
  const mergedDocks = { ...saved.panelDocks };

  for (const id of currentRegisteredIds) {
    if (!mergedDocks[id]) {
      mergedDocks[id] = defaultDocks[id] ?? "left";
    }
  }

  const floating = Array.from(new Set(saved.floatingPanels ?? []));

  const validActiveLeft = effectiveActiveTab(
    mergedDocks,
    saved.activeLeftTab,
    visibleIds,
    "left",
    floating,
  );
  const validActiveRight = effectiveActiveTab(
    mergedDocks,
    saved.activeRightTab,
    visibleIds,
    "right",
    floating,
  );

  return {
    ...saved,
    panelDocks: mergedDocks,
    floatingPanels: floating,
    activeLeftTab: validActiveLeft,
    activeRightTab: validActiveRight,
    leftOpen: saved.leftOpen && validActiveLeft !== null,
    rightOpen: saved.rightOpen && validActiveRight !== null,
  };
}

/**
 * Pure decision function: determines if a live chat message should show a toast.
 * - History messages never show toasts.
 * - If chat is floating in an active window, it's considered visible -> no toast.
 * - If chat is docked, shows toast ONLY if the dock is not currently visible/open.
 */
export function shouldShowChatToast(
  isHistory: boolean,
  chatDock: PanelDock,
  leftOpen: boolean,
  rightOpen: boolean,
  activeLeftTab: string | null,
  activeRightTab: string | null,
  isChatFloating = false,
): boolean {
  if (isHistory) return false;
  if (isChatFloating) return false;

  const isVisible =
    chatDock === "left"
      ? leftOpen && activeLeftTab === "chat"
      : rightOpen && activeRightTab === "chat";

  return !isVisible;
}

/**
 * Formats a live chat message into a compact toast representation.
 */
export function formatChatToastText(m: ChatMessageEvent): string {
  if (m.result) {
    const expr = m.raw || m.text || "dado";
    return `${m.author} · ${expr} → ${m.result.total}`;
  }
  if (m.whisperTo) {
    return `Susurro de ${m.author}: ${m.text}`;
  }
  return `${m.author}: ${m.text}`;
}

/**
 * Safe JSON parser and validator for layout storage.
 */
export function parseSavedLayout(raw: string | null): LayoutStateData | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    if (data.version !== CURRENT_LAYOUT_VERSION) return null;
    if (
      typeof data.preferredLeftWidth !== "number" ||
      !Number.isFinite(data.preferredLeftWidth)
    )
      return null;
    if (
      typeof data.preferredRightWidth !== "number" ||
      !Number.isFinite(data.preferredRightWidth)
    )
      return null;
    if (typeof data.leftOpen !== "boolean" || typeof data.rightOpen !== "boolean")
      return null;
    if (!data.panelDocks || typeof data.panelDocks !== "object") return null;

    for (const val of Object.values(data.panelDocks)) {
      if (val !== "left" && val !== "right") return null;
    }

    let floatingPanels: string[] = [];
    if (data.floatingPanels !== undefined) {
      if (!Array.isArray(data.floatingPanels)) return null;
      for (const item of data.floatingPanels) {
        if (typeof item !== "string") return null;
      }
      floatingPanels = Array.from(new Set(data.floatingPanels as string[]));
    }

    return {
      ...(data as Omit<LayoutStateData, "floatingPanels">),
      floatingPanels,
    };
  } catch {
    return null;
  }
}
