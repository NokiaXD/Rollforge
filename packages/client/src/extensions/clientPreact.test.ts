import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { h } from "preact";
import { useState } from "preact/hooks";
import { buildClientAPI } from "./bootstrap";

const packagesDir = resolve(process.cwd(), "..");

describe("client extensions get the host's preact", () => {
  it("hands out this very module's preact, so hooks share one instance", () => {
    const api = buildClientAPI();
    expect(api.ui.preact.h).toBe(h);
    expect(api.ui.preact.useState).toBe(useState);
  });

  //  Under the Vite dev server the optimizer serves the app its preact as
  //  `preact.js?v=<hash>` while an import map hands out `preact.js` — two
  //  module instances. Only one of them renders, so the other's useState()
  //  throws "Cannot read properties of undefined (reading '__H')".
  it("keeps preact out of the import map and out of every main.client.js", () => {
    const html = readFileSync(join(packagesDir, "client/index.html"), "utf8");
    const map = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1] ?? "{}";
    const entries: Record<string, string> = JSON.parse(map).imports ?? {};
    expect(Object.keys(entries).filter((k) => k.startsWith("preact"))).toEqual([]);

    for (const pkg of readdirSync(packagesDir)) {
      const file = join(packagesDir, pkg, "src/main.client.js");
      if (!existsSync(file)) continue;
      expect(readFileSync(file, "utf8"), file).not.toMatch(/from ["']preact/);
    }
  });
});
