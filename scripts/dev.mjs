// `pnpm dev` wrapper: the server only scans ROLLFORGE_EXTENSIONS (default
// <dataDir>/extensions) for `<dir>/<sub>/extension.json`, but example-rpg is a
// workspace package under packages/, so no extension loads out of the box.
// Pointing the scan at packages/ is enough: non-extension dirs are skipped.
// Override by exporting ROLLFORGE_EXTENSIONS before calling this.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extensionsDir = process.env.ROLLFORGE_EXTENSIONS ?? join(root, "packages");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

console.log(`[dev] ROLLFORGE_EXTENSIONS=${extensionsDir}`);

// Single command string instead of an args array: with `shell: true` Node warns
// (DEP0190) about unescaped args, and every token here is a static literal.
const child = spawn(`${pnpm} -r --parallel run dev`, {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, ROLLFORGE_EXTENSIONS: extensionsDir },
});
child.on("exit", (code) => process.exit(code ?? 0));
