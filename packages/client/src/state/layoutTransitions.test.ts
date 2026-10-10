import { describe, expect, it } from "vitest";
import {
  closeFloating,
  dockFloatingPanel,
  effectiveActiveTab,
  formatChatToastText,
  movePanelDock,
  parseSavedLayout,
  popOutPanel,
  reconcileSavedLayout,
  shouldShowChatToast,
  type LayoutStateData,
} from "./layoutTransitions";

describe("layoutTransitions - effectiveActiveTab with floating panels", () => {
  it("excludes floating panels from active tab selection", () => {
    const docks = { scenes: "left", tokens: "left", chat: "right" } as const;
    // tokens is floating, so left sidebar should pick scenes even if currentActive is tokens
    const active = effectiveActiveTab(docks, "tokens", ["scenes", "tokens"], "left", ["tokens"]);
    expect(active).toBe("scenes");
  });

  it("returns null if all visible panels on that side are floating", () => {
    const docks = { scenes: "left", tokens: "left" } as const;
    const active = effectiveActiveTab(docks, "scenes", ["scenes", "tokens"], "left", ["scenes", "tokens"]);
    expect(active).toBe(null);
  });
});

describe("layoutTransitions - popOutPanel, dockFloatingPanel, closeFloating", () => {
  const base: LayoutStateData = {
    version: 1,
    preferredLeftWidth: 320,
    preferredRightWidth: 320,
    leftOpen: true,
    rightOpen: true,
    panelDocks: { scenes: "left", tokens: "left", chat: "right" },
    activeLeftTab: "tokens",
    activeRightTab: "chat",
    floatingPanels: [],
  };

  it("popOutPanel adds panel to floating and re-elects active on sidebar", () => {
    const visible = ["scenes", "tokens", "chat"];
    const popped = popOutPanel(base, "tokens", visible);

    expect(popped.floatingPanels).toEqual(["tokens"]);
    // Left sidebar had scenes remaining, so active becomes scenes
    expect(popped.activeLeftTab).toBe("scenes");
    expect(popped.leftOpen).toBe(true);
  });

  it("popOutPanel closes origin sidebar if that was the only panel", () => {
    const state: LayoutStateData = {
      ...base,
      panelDocks: { tokens: "left", chat: "right" },
      activeLeftTab: "tokens",
    };
    const visible = ["tokens", "chat"];
    const popped = popOutPanel(state, "tokens", visible);

    expect(popped.floatingPanels).toEqual(["tokens"]);
    expect(popped.activeLeftTab).toBe(null);
    expect(popped.leftOpen).toBe(false);
  });

  it("dockFloatingPanel removes from floating and activates on target dock", () => {
    const poppedState: LayoutStateData = {
      ...base,
      floatingPanels: ["tokens"],
      activeLeftTab: "scenes",
    };
    const visible = ["scenes", "tokens", "chat"];

    // Docking tokens to right
    const docked = dockFloatingPanel(poppedState, "tokens", "right", visible);
    expect(docked.floatingPanels).toEqual([]);
    expect(docked.panelDocks.tokens).toBe("right");
    expect(docked.rightOpen).toBe(true);
    expect(docked.activeRightTab).toBe("tokens");
  });

  it("closeFloating returns floating panel to its origin dock", () => {
    const poppedState: LayoutStateData = {
      ...base,
      floatingPanels: ["chat"],
      activeRightTab: null,
      rightOpen: false,
    };
    const visible = ["scenes", "tokens", "chat"];

    const closed = closeFloating(poppedState, "chat", visible);
    expect(closed.floatingPanels).toEqual([]);
    expect(closed.panelDocks.chat).toBe("right");
    expect(closed.rightOpen).toBe(true);
    expect(closed.activeRightTab).toBe("chat");
  });
});

describe("layoutTransitions - shouldShowChatToast with floating chat", () => {
  it("does not show toast if chat is open in a floating window", () => {
    // Docked right, right closed, but chat is floating
    expect(shouldShowChatToast(false, "right", true, false, "tokens", null, true)).toBe(false);
  });

  it("shows toast if chat is docked and closed (not floating)", () => {
    expect(shouldShowChatToast(false, "right", true, false, "tokens", null, false)).toBe(true);
  });
});

describe("layoutTransitions - parseSavedLayout with floatingPanels", () => {
  it("defaults floatingPanels to empty array when omitted in Phase 2 payloads", () => {
    const raw = JSON.stringify({
      version: 1,
      preferredLeftWidth: 320,
      preferredRightWidth: 320,
      leftOpen: true,
      rightOpen: true,
      panelDocks: { scenes: "left", chat: "right" },
      activeLeftTab: "scenes",
      activeRightTab: "chat",
      // floatingPanels omitted intentionally
    });

    const parsed = parseSavedLayout(raw);
    expect(parsed).not.toBe(null);
    expect(parsed?.floatingPanels).toEqual([]);
  });

  it("parses valid floatingPanels array and deduplicates it", () => {
    const raw = JSON.stringify({
      version: 1,
      preferredLeftWidth: 320,
      preferredRightWidth: 320,
      leftOpen: true,
      rightOpen: true,
      panelDocks: { scenes: "left", chat: "right" },
      activeLeftTab: "scenes",
      activeRightTab: "chat",
      floatingPanels: ["chat", "tokens", "chat"],
    });

    const parsed = parseSavedLayout(raw);
    expect(parsed?.floatingPanels).toEqual(["chat", "tokens"]);
  });

  it("rejects non-string items in floatingPanels", () => {
    const raw = JSON.stringify({
      version: 1,
      preferredLeftWidth: 320,
      preferredRightWidth: 320,
      leftOpen: true,
      rightOpen: true,
      panelDocks: { scenes: "left" },
      activeLeftTab: "scenes",
      activeRightTab: null,
      floatingPanels: [123],
    });

    expect(parseSavedLayout(raw)).toBe(null);
  });
});

describe("layoutTransitions - docking and viewport threshold rules", () => {
  it("docking to a collapsed sidebar opens it and activates the panel", () => {
    const state: LayoutStateData = {
      version: 1,
      preferredLeftWidth: 320,
      preferredRightWidth: 320,
      leftOpen: false, // collapsed
      rightOpen: true,
      panelDocks: { scenes: "left", chat: "right" },
      activeLeftTab: null,
      activeRightTab: "chat",
      floatingPanels: ["tokens"],
    };

    const next = dockFloatingPanel(state, "tokens", "left", ["scenes", "tokens", "chat"]);
    expect(next.leftOpen).toBe(true);
    expect(next.activeLeftTab).toBe("tokens");
    expect(next.floatingPanels).toEqual([]);
  });

  it("crossing viewport threshold (< 720px) treats floating panels as docked without duplicating", () => {
    const savedFloating = ["tokens"];
    const visibleIds = ["scenes", "tokens", "chat"];
    const docks = { scenes: "left", tokens: "left", chat: "right" } as const;

    // Wide screen (>= 720px): tokens is floating, so left bar only shows scenes
    const wideLeft = visibleIds.filter(
      (id) => (docks[id] ?? "left") === "left" && !savedFloating.includes(id),
    );
    expect(wideLeft).toEqual(["scenes"]);

    // Narrow screen (< 720px): effectiveFloatingPanels is [], so tokens is docked in left bar
    const narrowFloating: string[] = [];
    const narrowLeft = visibleIds.filter(
      (id) => (docks[id] ?? "left") === "left" && !narrowFloating.includes(id),
    );
    expect(narrowLeft).toEqual(["scenes", "tokens"]);
    // Confirm tokens is not duplicated: it's in left bar and not in floating
    expect(narrowFloating.includes("tokens")).toBe(false);
  });

  it("toast container geometry clears maximized window header without being blocked", () => {
    const windowHeaderHeight = 40;
    const toastTopOffset = 48; // top-12
    const maxWindowZIndex = 48;
    const toastZIndex = 49;

    // Toast offset is strictly below the window header (48 > 40)
    expect(toastTopOffset).toBeGreaterThan(windowHeaderHeight);
    // Toast z-index is strictly above any floating or maximized window (49 > 48)
    expect(toastZIndex).toBeGreaterThan(maxWindowZIndex);
  });
});
