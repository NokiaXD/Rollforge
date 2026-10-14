export interface WindowBounds {
  viewportWidth: number;
  viewportHeight: number;
  windowWidth: number;
  windowHeight: number;
  headerHeight?: number;
  minVisibleHorizontal?: number;
}

/**
 * Clamps a window's (x, y) coordinates ensuring:
 * - Header stays vertically accessible within [0, viewportHeight - headerHeight]
 * - At least minVisibleHorizontal pixels remain on-screen horizontally
 */
export function clampPosition(
  pos: { x: number; y: number },
  bounds: WindowBounds,
): { x: number; y: number } {
  const headerHeight = bounds.headerHeight ?? 40;
  const minVisible = bounds.minVisibleHorizontal ?? 60;

  const maxY = Math.max(0, bounds.viewportHeight - headerHeight);
  const clampedY = Math.max(0, Math.min(pos.y, maxY));

  const minX = Math.min(0, minVisible - bounds.windowWidth);
  const maxX = Math.max(0, bounds.viewportWidth - minVisible);
  const clampedX = Math.max(minX, Math.min(pos.x, maxX));

  return { x: clampedX, y: clampedY };
}

/**
 * Resize handle directions: which edges the handle sits on.
 * West/North handles move the window origin instead of only growing the box.
 */
export type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const RESIZE_DIRS: readonly ResizeDir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export interface RectGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ResizeLimits {
  minWidth: number;
  minHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

/**
 * Pure resize math: applies a pointer delta to a starting rect for one handle
 * direction. West/North move the origin so that edge stays under the cursor.
 */
export function computeResizeRect(
  start: RectGeometry,
  delta: { dx: number; dy: number },
  dir: ResizeDir,
  limits: ResizeLimits,
): RectGeometry {
  const growsRight = dir.includes("e");
  const growsLeft = dir.includes("w");
  const growsDown = dir.includes("s");
  const growsUp = dir.includes("n");

  let w = start.w + (growsRight ? delta.dx : growsLeft ? -delta.dx : 0);
  let h = start.h + (growsDown ? delta.dy : growsUp ? -delta.dy : 0);

  // Right/bottom cannot push past the viewport. West/north grow the box the other
  // way, so only the minimum bounds them; clampPosition pulls them back on screen.
  const maxW = growsLeft ? Infinity : Math.max(limits.minWidth, limits.viewportWidth - start.x);
  const maxH = growsUp ? Infinity : Math.max(limits.minHeight, limits.viewportHeight - start.y);
  w = Math.max(limits.minWidth, Math.min(w, maxW));
  h = Math.max(limits.minHeight, Math.min(h, maxH));

  return {
    x: growsLeft ? start.x + (start.w - w) : start.x,
    y: growsUp ? start.y + (start.h - h) : start.y,
    w,
    h,
  };
}

/**
 * Calculates a cascading initial position for opening windows.
 */
export function calculateCascadePosition(
  step: number,
  baseX = 32,
  baseY = 64,
  stepOffset = 28,
  cycle = 6,
): { x: number; y: number } {
  const offset = (step % cycle) * stepOffset;
  return { x: baseX + offset, y: baseY + offset };
}

let globalCascadeStep = 0;
export function nextCascadeStep(): number {
  return globalCascadeStep++;
}

export const TOP_WINDOW_Z_INDEX = 48;
export const MAX_WINDOW_DEPTH = 18; // 48 - 18 = 30 (strictly above sidebars/activityBar at 10..20, below toasts at 49)

/**
 * Calculates a window's zIndex from its distance from the top of the focus stack.
 * z = 48 - min(distanceFromTop, 18).
 * The top window (distance 0) is always at 48.
 * Windows at distance >= 18 share layer 30.
 */
export function calculateWindowZIndex(distanceFromTop: number): number {
  const distance = Math.max(0, Math.floor(distanceFromTop));
  return TOP_WINDOW_Z_INDEX - Math.min(distance, MAX_WINDOW_DEPTH);
}

/**
 * Pure state transition for opening a window key (e.g. "doc:123" or "panel:chat").
 * - If not in order, appends to the top (focused).
 * - If already in order, moves it to the top (focused).
 */
export function openWindowState(
  currentOrder: readonly string[],
  windowKey: string,
): string[] {
  const withoutKey = currentOrder.filter((k) => k !== windowKey);
  return [...withoutKey, windowKey];
}

/**
 * Pure state transition for closing a window key.
 */
export function closeWindowState(
  currentOrder: readonly string[],
  windowKey: string,
): string[] {
  return currentOrder.filter((k) => k !== windowKey);
}

/**
 * Pure state transition for focusing a window key.
 * Moves key to the end of the focus order array if present.
 */
export function focusWindowState(
  currentOrder: readonly string[],
  windowKey: string,
): string[] {
  if (!currentOrder.includes(windowKey)) return [...currentOrder];
  const withoutKey = currentOrder.filter((k) => k !== windowKey);
  return [...withoutKey, windowKey];
}

/**
 * Helper to get distance from the top of the focus order (0 = active/top).
 */
export function getWindowDistanceFromTop(order: readonly string[], windowKey: string): number {
  const idx = order.indexOf(windowKey);
  if (idx < 0) return MAX_WINDOW_DEPTH;
  return order.length - 1 - idx;
}

/**
 * Helper to get rank of a window in the focus order.
 */
export function getWindowRank(order: readonly string[], windowKey: string): number {
  const idx = order.indexOf(windowKey);
  return idx >= 0 ? idx : 0;
}
