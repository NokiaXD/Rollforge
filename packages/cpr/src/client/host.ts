//  Runtime vars injected by activate().
//
//  KEY: h / Fragment / hooks come from api.ui.preact (the HOST's Preact copy),
//  assigned in setHost() before any component renders. We only use
//  `import type` from preact so the build emits zero preact runtime — no second
//  Preact instance, no broken hooks.
//
//  Declared at module scope so every component and helper can read them. They're
//  assigned once, before the first render, so reading them at call time is
//  always safe.

import type { ClientExtensionAPI } from "@rollforge/extension-api";

export let h: typeof import("preact").h;
export let useState: typeof import("preact/hooks").useState;
export let useEffect: typeof import("preact/hooks").useEffect;
export let useMemo: typeof import("preact/hooks").useMemo;
export let useRef: typeof import("preact/hooks").useRef;
export let api: ClientExtensionAPI;

export function setHost(hostApi: ClientExtensionAPI): void {
  api = hostApi;
  // Same instance the app uses, so hooks resolve against the host's renderer.
  ({ h } = api.ui.preact as unknown as typeof import("preact"));
  ({ useState, useEffect, useMemo, useRef } = api.ui.preact as unknown as typeof import("preact/hooks"));
}