// `pnpm dev` wrapper: the server only scans ROLLFORGE_EXTENSIONS (default
// <dataDir>/extensions) for `<dir>/<sub>/extension.json`, but example-rpg is a
// workspace package under packages/, so no extension loads out of the box.
// Pointing the scan at packages/ is enough: non-extension dirs are skipped.
// Override by exporting ROLLFORGE_EXTENSIONS before calling this.
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import readline from "node:readline";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extensionsDir = process.env.ROLLFORGE_EXTENSIONS ?? join(root, "packages");

// Prefer direct pnpm executable to avoid cmd.exe intercepting Ctrl+C on Windows
let pnpmCmd = "pnpm";
let useShell = false;
if (process.platform === "win32") {
  try {
    const test = spawnSync("pnpm", ["--version"], { shell: false });
    if (test.status === 0) {
      pnpmCmd = "pnpm";
      useShell = false;
    } else {
      pnpmCmd = "pnpm.cmd";
      useShell = true;
    }
  } catch {
    pnpmCmd = "pnpm.cmd";
    useShell = true;
  }
}

console.log(`[dev] ROLLFORGE_EXTENSIONS=${extensionsDir}`);

const child = spawn(
  useShell ? `${pnpmCmd} -r --parallel run dev` : pnpmCmd,
  useShell ? [] : ["-r", "--parallel", "run", "dev"],
  {
    stdio: "inherit",
    shell: useShell,
    env: { ...process.env, ROLLFORGE_EXTENSIONS: extensionsDir },
  },
);

let cleaningUp = false;
const cleanup = () => {
  if (cleaningUp) return;
  cleaningUp = true;
  if (child.pid) {
    if (process.platform === "win32") {
      try {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } catch {}
    } else {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
  }
  process.exit(0);
};

// On Windows, raw terminal keypress detection ensures Ctrl+C terminates immediately
// without cmd.exe's "Terminate batch job (Y/N)?" prompt hanging the process.
if (process.platform === "win32" && process.stdin.isTTY) {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
  }
  process.stdin.on("keypress", (_str, key) => {
    if (key && key.ctrl && key.name === "c") {
      cleanup();
    }
  });
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
if (process.platform === "win32") {
  process.on("SIGBREAK", cleanup);
}

child.on("exit", (code) => process.exit(code ?? 0));
