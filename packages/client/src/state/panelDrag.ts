import { computed, signal } from "@preact/signals";
import {
  canPopOut,
  dockFloating,
  floatingPanels,
  movePanel,
  popOut,
  preferredLeftSidebarWidth,
  preferredRightSidebarWidth,
  viewportWidth,
} from "./layout";
import { computeEffectiveSidebarWidths } from "../ui/layout/sidebarResize";

export type PanelDropZone = "left" | "right" | "center";

/** Zone currently under the pointer, or null when no panel drag is active. */
export const panelDropZone = signal<PanelDropZone | null>(null);

const draggedPanelId = signal<string | null>(null);

/**
 * "Soltar para abrir como ventana" only makes sense for a docked panel: an
 * already-floating one just gets repositioned by WindowFrame.
 */
export const showCenterDropHint = computed(
  () =>
    panelDropZone.value === "center" &&
    !floatingPanels.value.includes(draggedPanelId.value ?? ""),
);

// ponytail: mirrors ActivityBar's w-12. Reuse the class if the rail ever resizes.
const ACTIVITY_BAR_PX = 48;
const DRAG_THRESHOLD_PX = 6;

/**
 * Drop strips, measured as if both sidebars were open so a collapsed bar still
 * has a target: dropping there re-opens it (both dock transitions set open = true).
 */
const strips = computed(() => {
  const { left, right } = computeEffectiveSidebarWidths({
    preferredLeft: preferredLeftSidebarWidth.value,
    preferredRight: preferredRightSidebarWidth.value,
    viewportWidth: viewportWidth.value,
    leftOpen: true,
    rightOpen: true,
  });
  return { left: ACTIVITY_BAR_PX + left, right };
});

/** Pure hit-test: which drop zone owns this pointer x. */
export function zoneForX(
  x: number,
  s: { left: number; right: number },
  viewport: number,
): PanelDropZone {
  if (x < s.left) return "left";
  if (x > viewport - s.right) return "right";
  return "center";
}

let startX = 0;
let startY = 0;
let dragging = false;

function stop() {
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onUp);
}

/** The dragged panel swallows the click that follows the drop, so tabs still toggle. */
function suppressNextClick() {
  const swallow = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
}

function onMove(e: PointerEvent) {
  if (!draggedPanelId.value) return;
  if (!dragging) {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return;
    dragging = true;
    suppressNextClick();
  }
  const zone = zoneForX(e.clientX, strips.value, viewportWidth.value);
  if (panelDropZone.value !== zone) panelDropZone.value = zone;
}

function onUp(e: PointerEvent) {
  stop();
  const id = draggedPanelId.value;
  const wasDrag = dragging;
  draggedPanelId.value = null;
  dragging = false;
  panelDropZone.value = null;
  if (!id || !wasDrag) return;

  const zone = zoneForX(e.clientX, strips.value, viewportWidth.value);
  if (zone === "center") {
    // Already floating: WindowFrame has repositioned it. Otherwise pop out.
    if (!floatingPanels.value.includes(id) && canPopOut.value) popOut(id);
    return;
  }
  if (floatingPanels.value.includes(id)) dockFloating(id, zone);
  else movePanel(id, zone);
}

/**
 * Turn a header into a drag handle. `allowButtons` is for tab strips, whose
 * buttons must still react to a plain click (the drag swallows it instead).
 */
export function startPanelDrag(
  panelId: string,
  e: PointerEvent,
  allowButtons = false,
): void {
  if (e.button !== 0 || draggedPanelId.value) return;
  const target = e.target as HTMLElement | null;
  if (
    target &&
    !allowButtons &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.tagName === "BUTTON" ||
      target.tagName === "A" ||
      target.isContentEditable)
  ) {
    return;
  }
  draggedPanelId.value = panelId;
  startX = e.clientX;
  startY = e.clientY;
  dragging = false;
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}