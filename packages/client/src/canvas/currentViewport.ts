import type { Viewport } from "pixi-viewport";

//  The client extension host has no way to reach the Pixi instance: createPixi()
//  is called from a useEffect in ui/App.tsx and its result is a local const.
//  Extensions activate earlier than that (buildClientAPI runs at bootstrap), so a
//  captured value would be permanently null — hence a live reference plus a
//  callback list. Paso 24's `ruler` extension is the first consumer.
//
//  `onViewportReady` fires for EVERY viewport, not once: ui/App.tsx is HMR'd in
//  development and that recreates Pixi from scratch, orphaning anything attached
//  to the previous one. A callback that only fires on the first mount would leave
//  the extension holding a destroyed viewport with no way to notice.

let current: Viewport | null = null;
const ready = new Set<(vp: Viewport) => void>();

export function getViewport(): Viewport | null {
  return current;
}

export function onViewportReady(cb: (vp: Viewport) => void): void {
  ready.add(cb);
  if (current) cb(current);
}

export function setViewport(vp: Viewport | null): void {
  current = vp;
  if (!vp) return;
  for (const cb of [...ready]) cb(vp);
}
