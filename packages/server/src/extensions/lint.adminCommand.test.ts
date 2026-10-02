import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";

//  The builtins lint boundary only constrains imports inside
// extensions/builtins/. It does not, by itself, stop someone from wiring
// a chat command outside that folder (the previous /migrations host
// utility at db/migrationsCommand.ts did exactly that). This static
// check enforces the architectural rule: every chat command is
// contributed by an extension, and the only place that may register one
// directly on the registry is the manager itself.

// Files where a direct commandRegistry.register(...) call is allowed.
// Keep this list minimal — every entry must justify itself.
const ALLOWED_REGISTRATION_PATHS = [
  // ExtensionManager creates the scoped api.chat.registerCommand wrapper
  // that builtins go through. The bare registry is also used to roll
  // back on failed declarative contributions, which lives here.
  "src/extensions/manager.ts",
  // Server-side wiring of builtins into the registry's `extensionId`
  // accounting (already covered by manager, but keeps the rollup honest).
];

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      out.push(...walkTs(p));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

describe("admin command registration boundary", () => {
  it("no file outside extensions/builtins/ and the manager registers chat commands directly", () => {
    // packages/server is two levels up from this test file.
    const serverRoot = resolve(__dirname, "..", "..");
    const srcRoot = join(serverRoot, "src");
    const allowedAbs = new Set(
      ALLOWED_REGISTRATION_PATHS.map((p) => join(serverRoot, p)),
    );

    const files = walkTs(srcRoot);
    const offenders: string[] = [];

    for (const file of files) {
      if (allowedAbs.has(file)) continue;
      const rel = relative(srcRoot, file).split(sep).join("/");
      // builtins/ files are the legitimate registration surface for chat commands
      if (rel.startsWith("extensions/builtins/")) continue;
      const body = readFileSync(file, "utf-8");
      // Match a bare commandRegistry.register( call. api.chat.registerCommand
      // is the wrapper used by builtins and does not match.
      if (/commandRegistry\s*\.\s*register\s*\(/.test(body)) {
        offenders.push(rel);
      }
    }

    expect(offenders).toEqual([]);
  });
});