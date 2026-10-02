import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import { resolve } from "node:path";

describe("builtins boundary linting", () => {
  it("reports error when a builtin imports from outside allowed boundary or uses forbidden syntax", async () => {
    // When running inside packages/server, root is 2 levels up
    const rootDir = resolve(process.cwd(), "../../");
    const configFile = resolve(rootDir, "eslint.config.js");

    const eslint = new ESLint({
      overrideConfigFile: configFile,
      cwd: rootDir,
    });

    // 1. Forbidden relative import outside builtins
    const badImportCode = `
      import { attachSync } from "../../sync/socket";
      export function probe() { return attachSync; }
    `;
    const res1 = await eslint.lintText(badImportCode, {
      filePath: resolve(rootDir, "packages/server/src/extensions/builtins/bad1.ts"),
    });
    expect(res1[0]?.errorCount).toBeGreaterThan(0);
    expect(res1[0]?.messages.some((m) => m.ruleId === "no-restricted-imports")).toBe(true);

    // 2. Forbidden node:* import
    const badNodeCode = `
      import fs from "node:fs";
      export function probe() { return fs; }
    `;
    const res2 = await eslint.lintText(badNodeCode, {
      filePath: resolve(rootDir, "packages/server/src/extensions/builtins/bad2.ts"),
    });
    expect(res2[0]?.errorCount).toBeGreaterThan(0);
    expect(res2[0]?.messages.some((m) => m.ruleId === "no-restricted-imports")).toBe(true);

    // 3. Forbidden dynamic import()
    const badDynamicCode = `
      export async function probe() {
        return await import("node:path");
      }
    `;
    const res3 = await eslint.lintText(badDynamicCode, {
      filePath: resolve(rootDir, "packages/server/src/extensions/builtins/bad3.ts"),
    });
    expect(res3[0]?.errorCount).toBeGreaterThan(0);
    expect(res3[0]?.messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true);

    // 4. Allowed imports: @rollforge/extension-api
    const validCode = `
      import { CommandRejection, type ServerExtensionAPI } from "@rollforge/extension-api";
      export function activate(api: ServerExtensionAPI) {
        if (!api) throw new CommandRejection("not-a-command");
      }
    `;
    const res4 = await eslint.lintText(validCode, {
      filePath: resolve(rootDir, "packages/server/src/extensions/builtins/good.ts"),
    });
    expect(res4[0]?.errorCount).toBe(0);

    // 5. Paso 16 — same boundary rules apply to .tsx files. Negative case:
    // a builtin .tsx that reaches into the host's state module triggers
    // no-restricted-imports. Regression guard for the glob fix in
    // eslint.config.js (was `**/*.ts` only).
    const badTsxImport = `
      import { foo } from "../../state/documents";
      export function probe() { return foo; }
    `;
    const res5 = await eslint.lintText(badTsxImport, {
      filePath: resolve(rootDir, "packages/client/src/extensions/builtins/badClientBuiltin.tsx"),
    });
    expect(res5[0]?.messages.some((m) => m.ruleId === "no-restricted-imports")).toBe(true);

    // 6. Positive case: a builtin .tsx with an allowed import lints clean.
    // Confirms the rule does not over-fire on .tsx files.
    const goodTsxImport = `
      import { useState } from "preact/hooks";
      export function probe() { return useState; }
    `;
    const res6 = await eslint.lintText(goodTsxImport, {
      filePath: resolve(rootDir, "packages/client/src/extensions/builtins/goodClientBuiltin.tsx"),
    });
    expect(res6[0]?.errorCount).toBe(0);
  });
});
