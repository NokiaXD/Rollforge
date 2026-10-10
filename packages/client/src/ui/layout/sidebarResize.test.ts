import { describe, expect, it } from "vitest";
import {
  computeEffectiveSidebarWidths,
  DEFAULT_SIDEBAR_WIDTH,
  MIN_CANVAS_WIDTH,
  MIN_SIDEBAR_WIDTH,
  RESIZE_ACTIVE_THRESHOLD,
} from "./sidebarResize";

describe("sidebarResize - computeEffectiveSidebarWidths", () => {
  it("keeps preferred widths when viewport has ample space (1200px)", () => {
    const res = computeEffectiveSidebarWidths({
      preferredLeft: 320,
      preferredRight: 350,
      viewportWidth: 1200,
      leftOpen: true,
      rightOpen: true,
    });

    expect(res.left).toBe(320);
    expect(res.right).toBe(350);
    expect(res.canResize).toBe(true);
  });

  it("handles closed sidebars returning 0", () => {
    const res = computeEffectiveSidebarWidths({
      preferredLeft: 320,
      preferredRight: 320,
      viewportWidth: 1200,
      leftOpen: false,
      rightOpen: false,
    });

    expect(res.left).toBe(0);
    expect(res.right).toBe(0);
  });

  it("handles single sidebar open (e.g. only left open)", () => {
    const res = computeEffectiveSidebarWidths({
      preferredLeft: 400,
      preferredRight: 320,
      viewportWidth: 1000,
      leftOpen: true,
      rightOpen: false,
    });

    expect(res.left).toBe(400);
    expect(res.right).toBe(0);
    expect(res.canResize).toBe(true);
  });

  it("scales down sidebars in intermediate viewports (between 720px and 920px)", () => {
    // Viewport 850px: maxCombined = 850 - 280 = 570px
    // Preferred total: 320 + 320 = 640px. Excess = 70px.
    const res = computeEffectiveSidebarWidths({
      preferredLeft: 320,
      preferredRight: 320,
      viewportWidth: 850,
      leftOpen: true,
      rightOpen: true,
    });

    expect(res.left + res.right).toBeLessThanOrEqual(850 - MIN_CANVAS_WIDTH);
    expect(res.left).toBeGreaterThanOrEqual(MIN_SIDEBAR_WIDTH);
    expect(res.right).toBeGreaterThanOrEqual(MIN_SIDEBAR_WIDTH);
    expect(res.canResize).toBe(true);
  });

  it("allows canvas to yield below 720px threshold without dropping below MIN_SIDEBAR_WIDTH", () => {
    // Viewport 650px (below 720px threshold)
    const res = computeEffectiveSidebarWidths({
      preferredLeft: 320,
      preferredRight: 320,
      viewportWidth: 650,
      leftOpen: true,
      rightOpen: true,
    });

    // Canvas yields: sidebars stay at 220px each
    expect(res.left).toBe(MIN_SIDEBAR_WIDTH);
    expect(res.right).toBe(MIN_SIDEBAR_WIDTH);
    expect(res.canResize).toBe(false);
  });

  it("disables interactive resizing below RESIZE_ACTIVE_THRESHOLD (720px)", () => {
    expect(RESIZE_ACTIVE_THRESHOLD).toBe(720);

    const at719 = computeEffectiveSidebarWidths({
      preferredLeft: 320,
      preferredRight: 320,
      viewportWidth: 719,
      leftOpen: true,
      rightOpen: true,
    });
    expect(at719.canResize).toBe(false);

    const at720 = computeEffectiveSidebarWidths({
      preferredLeft: 320,
      preferredRight: 320,
      viewportWidth: 720,
      leftOpen: true,
      rightOpen: true,
    });
    expect(at720.canResize).toBe(true);
  });

  it("preserves preferred width when viewport shrinks and then expands again", () => {
    const preferredLeft = 450;
    const preferredRight = 400;

    // 1. Shrunk viewport (750px): constrained
    const shrunk = computeEffectiveSidebarWidths({
      preferredLeft,
      preferredRight,
      viewportWidth: 750,
      leftOpen: true,
      rightOpen: true,
    });
    expect(shrunk.left).toBeLessThan(preferredLeft);

    // 2. Expanded viewport (1400px): restores original preferred without mutation
    const expanded = computeEffectiveSidebarWidths({
      preferredLeft,
      preferredRight,
      viewportWidth: 1400,
      leftOpen: true,
      rightOpen: true,
    });
    expect(expanded.left).toBe(preferredLeft);
    expect(expanded.right).toBe(preferredRight);
  });
});
