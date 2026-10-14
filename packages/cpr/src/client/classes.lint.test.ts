import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ALLOWLIST = new Set([
  "custom-scroll",
  "custom-select",
  "active",
  "done",
]);

function getClientFiles(): string[] {
  const dir = __dirname;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".tsx") || (f.endsWith(".ts") && !f.endsWith(".test.ts")))
    .map((f) => join(dir, f));
}

function extractClassTokens(content: string): { token: string; file: string }[] {
  const tokens: { token: string; file: string }[] = [];
  // Matches class="..." or className="..." and template literals class={`...`}
  const classRegex = /class(?:Name)?=(?:["']([^"']+)["']|{`([^`]+)`})/g;
  let match: RegExpExecArray | null;

  while ((match = classRegex.exec(content)) !== null) {
    const raw = match[1] ?? match[2] ?? "";
    // Strip template interpolations like ${...}
    const clean = raw.replace(/\${[^}]+}/g, " ");
    const words = clean.split(/\s+/).filter(Boolean);
    for (const w of words) {
      tokens.push({ token: w, file: "" });
    }
  }

  return tokens;
}

function getDefinedCprClasses(): Set<string> {
  const cssPath = join(__dirname, "cpr.css");
  const css = readFileSync(cssPath, "utf8");
  const matches = [...css.matchAll(/\.(cpr-[a-zA-Z0-9_-]+)/g)];
  return new Set(matches.map((m) => m[1]!));
}

describe("CPR styles isolation & linting", () => {
  it("only uses cpr-* or allowlisted classes in CPR client JSX/TSX (no Tailwind leaks)", () => {
    const files = getClientFiles();
    const foreignTokens: { file: string; token: string }[] = [];

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      const tokens = extractClassTokens(content);

      for (const { token } of tokens) {
        if (!token.startsWith("cpr-") && !ALLOWLIST.has(token)) {
          foreignTokens.push({ file, token });
        }
      }
    }

    expect(foreignTokens).toEqual([]);
  });

  it("ensures every cpr-* class used in TSX files is defined in cpr.css (preventing typos)", () => {
    const definedClasses = getDefinedCprClasses();
    const files = getClientFiles().filter((f) => f.endsWith(".tsx"));
    const missing: { file: string; class: string }[] = [];

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      const tokens = extractClassTokens(content);

      for (const { token } of tokens) {
        if (token.startsWith("cpr-") && !definedClasses.has(token)) {
          missing.push({ file, class: token });
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
