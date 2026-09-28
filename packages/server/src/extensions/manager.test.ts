import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ExtensionManager } from "./manager";
import { ChatCommandRegistry } from "./registry";
import { HooksEngine } from "@rollforge/extension-api";
import type { ExtensionManifest } from "@rollforge/protocol";

describe("ExtensionManager lifecycle and operations", () => {
  let hooks: HooksEngine;
  let registry: ChatCommandRegistry;
  let manager: ExtensionManager;

  beforeEach(() => {
    hooks = new HooksEngine();
    registry = new ChatCommandRegistry();
    manager = new ExtensionManager({
      hooks,
      commandRegistry: registry,
      activationTimeoutMs: 1000,
    });
  });

  const baseManifest: ExtensionManifest = {
    id: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    engines: { core: ">=0.1.0" },
    activationEvents: ["onCommand:test"],
    contributes: {
      chatCommands: [
        { name: "test", description: "Test command", requiredPermission: "Player" },
      ],
    },
  };

  it("transitions states: Registered -> Active -> Inactive", async () => {
    const activateSpy = vi.fn();
    const deactivateSpy = vi.fn();

    manager.registerExtension({
      manifest: baseManifest,
      activate: activateSpy,
      deactivate: deactivateSpy,
    });

    expect(manager.getExtension("test-plugin")?.state).toBe("Registered");

    await manager.ensureActivated("test-plugin");
    expect(manager.getExtension("test-plugin")?.state).toBe("Active");
    expect(activateSpy).toHaveBeenCalledTimes(1);

    await manager.deactivateExtension("test-plugin");
    expect(manager.getExtension("test-plugin")?.state).toBe("Inactive");
    expect(deactivateSpy).toHaveBeenCalledTimes(1);
  });

  it("marks state as Errored when activate() throws", async () => {
    manager.registerExtension({
      manifest: baseManifest,
      activate: () => {
        throw new Error("crash on activate");
      },
    });

    await expect(manager.ensureActivated("test-plugin")).rejects.toThrow("crash on activate");
    expect(manager.getExtension("test-plugin")?.state).toBe("Errored");

    // Subsequent ensureActivated does not re-attempt and rejects immediately
    await expect(manager.ensureActivated("test-plugin")).rejects.toThrow(
      'Extension "test-plugin" is in Errored state'
    );
  });

  it("handles timeout with vi.useFakeTimers(): sets Errored, clears timers, and ignores late registrations", async () => {
    vi.useFakeTimers();

    let lateRegisterCommand: (() => void) | null = null;
    manager.registerExtension({
      manifest: baseManifest,
      activate: (api) =>
        new Promise((resolve) => {
          // Store late registration for after timeout
          setTimeout(() => {
            lateRegisterCommand = () => {
              api.chat.registerCommand({
                name: "late",
                description: "late",
                handler: async () => {},
              });
            };
            resolve();
          }, 2000);
        }),
    });

    const activatePromise = manager.ensureActivated("test-plugin");
    const rejectionSpy = vi.fn();
    activatePromise.catch(rejectionSpy);

    // Fast-forward past 1000ms timeout
    vi.advanceTimersByTime(1100);

    await expect(activatePromise).rejects.toThrow('timed out after 1000ms');
    expect(manager.getExtension("test-plugin")?.state).toBe("Errored");

    // Fast forward to resolve the delayed promise and attempt late registration
    vi.advanceTimersByTime(1500);
    if (lateRegisterCommand) {
      (lateRegisterCommand as () => void)();
    }

    // Late command registration must have been ignored by generation guard
    expect(registry.has("late")).toBe(false);

    // No timers left hanging
    expect(vi.getTimerCount()).toBe(0);

    vi.useRealTimers();
  });

  it("clears timeout timer on successful activation (vi.getTimerCount() === 0)", async () => {
    vi.useFakeTimers();

    manager.registerExtension({
      manifest: baseManifest,
      activate: async () => {},
    });

    await manager.ensureActivated("test-plugin");
    expect(manager.getExtension("test-plugin")?.state).toBe("Active");
    expect(vi.getTimerCount()).toBe(0);

    vi.useRealTimers();
  });

  it("shares activation promise across concurrent invocations", async () => {
    let activateCount = 0;
    manager.registerExtension({
      manifest: baseManifest,
      activate: async () => {
        activateCount++;
        await new Promise((r) => setTimeout(r, 20));
      },
    });

    await Promise.all([
      manager.ensureActivated("test-plugin"),
      manager.ensureActivated("test-plugin"),
      manager.ensureActivated("test-plugin"),
    ]);

    expect(activateCount).toBe(1);
    expect(manager.getExtension("test-plugin")?.state).toBe("Active");
  });

  it("allows programmatic retry via retryExtension()", async () => {
    let attempts = 0;
    manager.registerExtension({
      manifest: baseManifest,
      activate: async () => {
        attempts++;
        if (attempts === 1) throw new Error("first fail");
      },
    });

    await expect(manager.ensureActivated("test-plugin")).rejects.toThrow("first fail");
    expect(manager.getExtension("test-plugin")?.state).toBe("Errored");

    await manager.retryExtension("test-plugin");
    expect(attempts).toBe(2);
    expect(manager.getExtension("test-plugin")?.state).toBe("Active");
  });

  it("rejects player invoking GM command with forbidden without calling activate()", async () => {
    const activateSpy = vi.fn();
    const gmManifest: ExtensionManifest = {
      id: "gm-plugin",
      name: "GM Plugin",
      version: "1.0.0",
      engines: { core: ">=0.1.0" },
      activationEvents: ["onCommand:gmcmd"],
      contributes: {
        chatCommands: [
          { name: "gmcmd", description: "GM only", requiredPermission: "GM" },
        ],
      },
    };

    manager.registerExtension({
      manifest: gmManifest,
      activate: activateSpy,
    });

    // Check permission prior to activation
    expect(manager.canInvoke("gmcmd", "Player")).toBe(false);
    expect(manager.canInvoke("gmcmd", "GM")).toBe(true);
    expect(activateSpy).not.toHaveBeenCalled();
  });

  it("throws collision error when two extensions contribute identical commands", () => {
    manager.registerExtension({
      manifest: baseManifest,
    });

    const conflictingManifest: ExtensionManifest = {
      id: "conflict-plugin",
      name: "Conflict Plugin",
      version: "1.0.0",
      engines: { core: ">=0.1.0" },
      activationEvents: ["onCommand:test"],
      contributes: {
        chatCommands: [
          { name: "test", description: "Duplicate test" },
        ],
      },
    };

    expect(() => {
      manager.registerExtension({ manifest: conflictingManifest });
    }).toThrow('conflicts with extension "test-plugin"');
  });
});
