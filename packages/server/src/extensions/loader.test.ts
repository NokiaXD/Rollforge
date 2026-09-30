import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExtensionManager } from "./manager";
import { ChatCommandRegistry } from "./registry";
import { loadExtensions, discoverExtensions } from "./loader";
import { HooksEngine } from "@rollforge/extension-api";

// Extensions are plain ESM on disk: no build step, main.server is a .js file.
function writeExtension(
  dir: string,
  name: string,
  manifest: unknown,
  files: Record<string, string> = {}
): void {
  const root = join(dir, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "extension.json"),
    typeof manifest === "string" ? manifest : JSON.stringify(manifest, null, 2),
  );
  for (const [file, contents] of Object.entries(files)) {
    writeFileSync(join(root, file), contents);
  }
}

describe("extension disk loader", () => {
  let dir: string;
  let manager: ExtensionManager;
  let registry: ChatCommandRegistry;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rollforge-ext-"));
    registry = new ChatCommandRegistry();
    manager = new ExtensionManager({
      hooks: new HooksEngine(),
      commandRegistry: registry,
      activationTimeoutMs: 1000,
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns nothing for a missing extensions directory", () => {
    expect(discoverExtensions(join(dir, "nope"))).toEqual([]);
  });

  it("loads main.server and activates it on its command event", async () => {
    writeExtension(
      dir,
      "hello-ext",
      {
        id: "hello-ext",
        name: "Hello",
        version: "1.0.0",
        engines: { core: ">=0.1.0" },
        activationEvents: ["onCommand:hello"],
        main: { server: "main.server.js" },
        contributes: { chatCommands: [{ name: "hello", description: "Say hello" }] },
      },
      {
        "main.server.js": `
          export function activate(api) {
            api.chat.registerCommand({
              name: "hello",
              description: "Say hello",
              handler: async () => {},
            });
          }
          export function deactivate() {}
        `,
      },
    );

    const result = await loadExtensions(manager, dir);
    expect(result.failed).toEqual([]);
    expect(result.loaded).toEqual(["hello-ext"]);

    // contributes are visible before activation (declarative, no code run)
    expect(manager.getContributedCommand("hello")?.extensionId).toBe("hello-ext");
    expect(registry.has("hello")).toBe(false);

    await manager.dispatchActivationEvent("onCommand:hello");
    expect(manager.getExtension("hello-ext")?.state).toBe("Active");
    expect(registry.has("hello")).toBe(true);
  });

  it("registers a contributions-only extension with no main.server", async () => {
    writeExtension(dir, "declarative", {
      id: "declarative",
      name: "Declarative",
      version: "1.0.0",
      engines: { core: ">=0.1.0" },
      activationEvents: ["onReady"],
      contributes: { chatCommands: [{ name: "ping", description: "Ping" }] },
    });

    const result = await loadExtensions(manager, dir);
    expect(result).toEqual({ loaded: ["declarative"], failed: [] });
    await manager.dispatchActivationEvent("onReady");
    expect(manager.getExtension("declarative")?.state).toBe("Active");
  });

  it("keeps going when one extension has a broken manifest or entry", async () => {
    writeExtension(dir, "bad-json", "{ not json");
    writeExtension(dir, "bad-incompatible", {
      id: "bad-incompatible",
      name: "Bad",
      version: "1.0.0",
      engines: { core: ">=99.0.0" },
      activationEvents: ["onReady"],
    });
    writeExtension(dir, "bad-entry", {
      id: "bad-entry",
      name: "Missing file",
      version: "1.0.0",
      engines: { core: ">=0.1.0" },
      activationEvents: ["onReady"],
      main: { server: "does-not-exist.js" },
    });
    writeExtension(dir, "good", {
      id: "good",
      name: "Good",
      version: "1.0.0",
      engines: { core: ">=0.1.0" },
      activationEvents: ["onReady"],
    });

    const result = await loadExtensions(manager, dir);
    expect(result.loaded).toEqual(["good"]);
    expect(result.failed.map((f) => f.id).sort()).toEqual([
      "bad-entry",
      "bad-incompatible",
      "bad-json",
    ]);
  });

  it("rejects a main.server path that escapes the extension folder", async () => {
    writeExtension(
      dir,
      "escape",
      {
        id: "escape",
        name: "Escape",
        version: "1.0.0",
        engines: { core: ">=0.1.0" },
        activationEvents: ["onReady"],
        main: { server: "../../evil.js" },
      },
      { "evil.js": "export function activate() {}" },
    );

    const result = await loadExtensions(manager, dir);
    expect(result.loaded).toEqual([]);
    expect(result.failed[0]?.error).toMatch(/must be a relative path/);
  });

  it("skips an already registered id instead of throwing", async () => {
    const manifest = {
      id: "dupe",
      name: "Dupe",
      version: "1.0.0",
      engines: { core: ">=0.1.0" },
      activationEvents: ["onReady"],
    };
    writeExtension(dir, "dupe", manifest);

    expect((await loadExtensions(manager, dir)).loaded).toEqual(["dupe"]);
    expect((await loadExtensions(manager, dir)).loaded).toEqual([]);
    expect((await loadExtensions(manager, dir)).failed).toEqual([]);
  });
});
