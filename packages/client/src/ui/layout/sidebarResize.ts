export const MIN_SIDEBAR_WIDTH = 220;
export const MAX_SIDEBAR_WIDTH = 600;
export const DEFAULT_SIDEBAR_WIDTH = 320;
export const MIN_CANVAS_WIDTH = 280;

// Derived threshold where both sidebars at min (220*2 = 440) + min canvas (280) fit.
export const RESIZE_ACTIVE_THRESHOLD = MIN_SIDEBAR_WIDTH * 2 + MIN_CANVAS_WIDTH; // 720px

export interface SidebarWidthsInput {
  preferredLeft: number;
  preferredRight: number;
  viewportWidth: number;
  leftOpen: boolean;
  rightOpen: boolean;
}

export interface EffectiveSidebarWidths {
  left: number;
  right: number;
  canResize: boolean;
}

/**
 * Computes the effective sidebar widths based on preferred widths,
 * open states, and current viewport constraints.
 *
 * Rules:
 * - When closed, width is 0.
 * - When viewport < RESIZE_ACTIVE_THRESHOLD, interactive resizing is disabled.
 * - Below 720px with both open, canvas yields before hiding or shrinking panels below MIN_SIDEBAR_WIDTH.
 * - Upper constraint: left + right <= viewport - MIN_CANVAS_WIDTH (if space permits).
 */
export function computeEffectiveSidebarWidths({
  preferredLeft,
  preferredRight,
  viewportWidth,
  leftOpen,
  rightOpen,
}: SidebarWidthsInput): EffectiveSidebarWidths {
  const canResize = viewportWidth >= RESIZE_ACTIVE_THRESHOLD;

  let left = leftOpen
    ? Math.max(MIN_SIDEBAR_WIDTH, Math.min(preferredLeft, MAX_SIDEBAR_WIDTH))
    : 0;
  let right = rightOpen
    ? Math.max(MIN_SIDEBAR_WIDTH, Math.min(preferredRight, MAX_SIDEBAR_WIDTH))
    : 0;

  if (!leftOpen && !rightOpen) {
    return { left: 0, right: 0, canResize };
  }

  // If only one is open
  if (leftOpen && !rightOpen) {
    const maxAvailable = Math.max(MIN_SIDEBAR_WIDTH, viewportWidth - MIN_CANVAS_WIDTH);
    return {
      left: Math.min(left, Math.max(MIN_SIDEBAR_WIDTH, maxAvailable)),
      right: 0,
      canResize,
    };
  }

  if (!leftOpen && rightOpen) {
    const maxAvailable = Math.max(MIN_SIDEBAR_WIDTH, viewportWidth - MIN_CANVAS_WIDTH);
    return {
      left: 0,
      right: Math.min(right, Math.max(MIN_SIDEBAR_WIDTH, maxAvailable)),
      canResize,
    };
  }

  // Both open
  const totalPreferred = left + right;
  const maxCombined = viewportWidth - MIN_CANVAS_WIDTH;

  if (totalPreferred > maxCombined) {
    // If viewport is so small that even 2 * MIN_SIDEBAR_WIDTH exceeds maxCombined,
    // canvas yields: keep sidebars at MIN_SIDEBAR_WIDTH.
    if (maxCombined <= MIN_SIDEBAR_WIDTH * 2) {
      return {
        left: MIN_SIDEBAR_WIDTH,
        right: MIN_SIDEBAR_WIDTH,
        canResize,
      };
    }

    // Proportionally scale down while respecting MIN_SIDEBAR_WIDTH
    const excess = totalPreferred - maxCombined;
    const leftSlack = left - MIN_SIDEBAR_WIDTH;
    const rightSlack = right - MIN_SIDEBAR_WIDTH;
    const totalSlack = leftSlack + rightSlack;

    if (totalSlack > 0) {
      const leftReduction = Math.min(leftSlack, (excess * leftSlack) / totalSlack);
      const rightReduction = Math.min(rightSlack, excess - leftReduction);
      left = Math.round(left - leftReduction);
      right = Math.round(right - rightReduction);
    } else {
      left = MIN_SIDEBAR_WIDTH;
      right = MIN_SIDEBAR_WIDTH;
    }
  }

  return { left, right, canResize };
}
