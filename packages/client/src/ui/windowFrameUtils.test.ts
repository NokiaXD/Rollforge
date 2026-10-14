import { describe, expect, it } from "vitest";
import {
  calculateCascadePosition,
  calculateWindowZIndex,
  clampPosition,
  closeWindowState,
  computeResizeRect,
  focusWindowState,
  getWindowDistanceFromTop,
  getWindowRank,
  openWindowState,
} from "./windowFrameUtils";

const LIMITS = {
  minWidth: 240,
  minHeight: 160,
  viewportWidth: 1200,
  viewportHeight: 800,
};

describe("windowFrameUtils - computeResizeRect", () => {
  const start = { x: 100, y: 100, w: 400, h: 300 };

  it("s/e only grow the box, origin never moves", () => {
    expect(computeResizeRect(start, { dx: 50, dy: 40 }, "se", LIMITS)).toEqual({
      x: 100,
      y: 100,
      w: 450,
      h: 340,
    });
  });

  it("w moves the left edge: dragging right shrinks and pushes x forward", () => {
    expect(computeResizeRect(start, { dx: -50, dy: 0 }, "w", LIMITS)).toEqual({
      x: 50,
      y: 100,
      w: 450,
      h: 300,
    });
    expect(computeResizeRect(start, { dx: 50, dy: 0 }, "w", LIMITS)).toEqual({
      x: 150,
      y: 100,
      w: 350,
      h: 300,
    });
  });

  it("n moves the top edge like w moves the left one", () => {
    expect(computeResizeRect(start, { dx: 0, dy: 60 }, "n", LIMITS)).toEqual({
      x: 100,
      y: 160,
      w: 400,
      h: 240,
    });
  });

  it("respects the minimum size on both axes", () => {
    // dragging a nw handle inward (positive delta) shrinks from the top-left
    const r = computeResizeRect(start, { dx: 9999, dy: 9999 }, "nw", LIMITS);
    expect(r).toEqual({ x: 100 + 400 - 240, y: 100 + 300 - 160, w: 240, h: 160 });
  });

  it("cannot grow past the viewport from the right/bottom edges", () => {
    const nearEdge = { x: 900, y: 600, w: 250, h: 100 };
    const r = computeResizeRect(nearEdge, { dx: 5000, dy: 5000 }, "se", LIMITS);
    expect(r.w).toBe(300);
    expect(r.h).toBe(200);
  });

  it("ignores the axis the handle does not touch", () => {
    expect(computeResizeRect(start, { dx: 60, dy: 60 }, "e", LIMITS)).toEqual({
      x: 100,
      y: 100,
      w: 460,
      h: 300,
    });
  });
});

describe("windowFrameUtils - clampPosition", () => {
  it("keeps window within normal viewport bounds", () => {
    const bounds = {
      viewportWidth: 1000,
      viewportHeight: 800,
      windowWidth: 400,
      windowHeight: 500,
      headerHeight: 40,
      minVisibleHorizontal: 60,
    };

    const safe = clampPosition({ x: 200, y: 150 }, bounds);
    expect(safe).toEqual({ x: 200, y: 150 });

    const topClamped = clampPosition({ x: 200, y: -50 }, bounds);
    expect(topClamped.y).toBe(0);

    const bottomClamped = clampPosition({ x: 200, y: 900 }, bounds);
    expect(bottomClamped.y).toBe(760);

    const leftClamped = clampPosition({ x: -500, y: 100 }, bounds);
    expect(leftClamped.x).toBe(-340);

    const rightClamped = clampPosition({ x: 1200, y: 100 }, bounds);
    expect(rightClamped.x).toBe(940);
  });

  it("handles viewport smaller than window without crashing or NaN", () => {
    const bounds = {
      viewportWidth: 320,
      viewportHeight: 480,
      windowWidth: 500,
      windowHeight: 600,
      headerHeight: 40,
      minVisibleHorizontal: 60,
    };

    const res = clampPosition({ x: 0, y: 0 }, bounds);
    expect(res.y).toBe(0);
    expect(res.x).toBe(0);
  });
});

describe("windowFrameUtils - calculateCascadePosition", () => {
  it("cycles cascading positions according to step count", () => {
    const pos0 = calculateCascadePosition(0, 30, 60, 20, 3);
    expect(pos0).toEqual({ x: 30, y: 60 });

    const pos1 = calculateCascadePosition(1, 30, 60, 20, 3);
    expect(pos1).toEqual({ x: 50, y: 80 });

    const pos2 = calculateCascadePosition(2, 30, 60, 20, 3);
    expect(pos2).toEqual({ x: 70, y: 100 });

    const pos3 = calculateCascadePosition(3, 30, 60, 20, 3);
    expect(pos3).toEqual({ x: 30, y: 60 });
  });
});

describe("windowFrameUtils - window stack and bounded z-index", () => {
  it("calculates layer from top of stack: z = 48 - min(distanceFromTop, 18)", () => {
    // Top window (distance 0) is at 48
    expect(calculateWindowZIndex(0)).toBe(48);
    // 1 position below top is at 47
    expect(calculateWindowZIndex(1)).toBe(47);
    // 18 positions below top is at 30
    expect(calculateWindowZIndex(18)).toBe(30);
    // Beyond 18: stays at 30, never drops below 30 or exceeds 48
    expect(calculateWindowZIndex(19)).toBe(30);
    expect(calculateWindowZIndex(100)).toBe(30);
  });

  it("handles 25 windows: focusing the oldest window brings it on top of all others", () => {
    // 25 windows open: win:0 is oldest (bottom), win:24 is newest (top)
    const initialOrder = Array.from({ length: 25 }, (_, i) => `win:${i}`);

    // Check oldest window initially
    const oldestDistBefore = getWindowDistanceFromTop(initialOrder, "win:0");
    expect(oldestDistBefore).toBe(24);
    expect(calculateWindowZIndex(oldestDistBefore)).toBe(30);

    // Check newest window initially
    const newestDistBefore = getWindowDistanceFromTop(initialOrder, "win:24");
    expect(newestDistBefore).toBe(0);
    expect(calculateWindowZIndex(newestDistBefore)).toBe(48);

    // Focus the oldest window ("win:0")
    const updatedOrder = focusWindowState(initialOrder, "win:0");
    expect(updatedOrder[updatedOrder.length - 1]).toBe("win:0");

    // "win:0" is now at top (distance 0 -> zIndex 48)
    const oldestDistAfter = getWindowDistanceFromTop(updatedOrder, "win:0");
    expect(oldestDistAfter).toBe(0);
    expect(calculateWindowZIndex(oldestDistAfter)).toBe(48);

    // The previous top window ("win:24") is now 1 below top (distance 1 -> zIndex 47)
    const prevTopDistAfter = getWindowDistanceFromTop(updatedOrder, "win:24");
    expect(prevTopDistAfter).toBe(1);
    expect(calculateWindowZIndex(prevTopDistAfter)).toBe(47);

    // All other windows are strictly below 48
    for (let i = 1; i < 25; i++) {
      const dist = getWindowDistanceFromTop(updatedOrder, `win:${i}`);
      expect(calculateWindowZIndex(dist)).toBeLessThan(48);
    }
  });

  it("openWindowState appends and moves to top without duplicate entries", () => {
    let order = openWindowState([], "doc:1");
    expect(order).toEqual(["doc:1"]);

    order = openWindowState(order, "panel:chat");
    expect(order).toEqual(["doc:1", "panel:chat"]);

    // Opening doc:1 again moves it to top
    order = openWindowState(order, "doc:1");
    expect(order).toEqual(["panel:chat", "doc:1"]);
  });

  it("closeWindowState removes the window key cleanly", () => {
    const order = ["doc:1", "panel:chat", "doc:2"];
    const next = closeWindowState(order, "panel:chat");
    expect(next).toEqual(["doc:1", "doc:2"]);
  });

  it("focusWindowState shifts focused window to top and calculates rank and distance", () => {
    const order = ["doc:1", "panel:chat", "doc:2"];
    const focused = focusWindowState(order, "doc:1");
    expect(focused).toEqual(["panel:chat", "doc:2", "doc:1"]);

    expect(getWindowRank(focused, "panel:chat")).toBe(0);
    expect(getWindowRank(focused, "doc:2")).toBe(1);
    expect(getWindowRank(focused, "doc:1")).toBe(2);

    expect(getWindowDistanceFromTop(focused, "doc:1")).toBe(0);
    expect(getWindowDistanceFromTop(focused, "doc:2")).toBe(1);
    expect(getWindowDistanceFromTop(focused, "panel:chat")).toBe(2);
  });
});
