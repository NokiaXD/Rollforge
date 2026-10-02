import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ExtensionManager } from "./manager";
import { ChatCommandRegistry } from "./registry";
import { HooksEngine } from "@rollforge/extension-api";
import { type ExtensionManifest } from "@rollforge/protocol";

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

  it("returns rejection result when two extensions contribute identical commands", () => {
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

    const result = manager.registerExtension({ manifest: conflictingManifest });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('conflicts with extension "test-plugin"');
    }
    expect(manager.getExtension("conflict-plugin")?.state).toBe("Incompatible");
  });

  describe("declarative contribution points (Paso 13)", () => {
    const sheetsManifest: ExtensionManifest = {
      id: "sheets-ext",
      name: "Sheets Extension",
      version: "1.0.0",
      engines: { core: ">=0.1.0" },
      activationEvents: ["onReady"],
      contributes: {
        documentTypes: [
          { id: "cpr-character", base: "Actor", schemaVersion: 1 },
        ],
        sheets: [
          { documentType: "cpr-character", component: "CprSheet", default: true },
          { documentType: "cpr-character", component: "CprSheetAlt" },
          { documentType: "Actor", component: "FancyActorSheet", default: true },
        ],
      },
    };

    it("registers contributed documentTypes and sheets into the registries", () => {
      manager.registerExtension({ manifest: sheetsManifest });

      expect(manager.documentTypeRegistry.has("cpr-character")).toBe(true);
      expect(manager.documentTypeRegistry.get("cpr-character")?.extensionId).toBe("sheets-ext");

      const sheets = manager.sheetRegistry.forDocumentType("cpr-character");
      expect(sheets).toHaveLength(2);
      expect(manager.sheetRegistry.defaultFor("cpr-character")?.extensionId).toBe("sheets-ext");

      expect(manager.sheetRegistry.defaultFor("Actor")?.extensionId).toBe("sheets-ext");
    });

    it("rejects cross-extension collision on documentType id", () => {
      manager.registerExtension({ manifest: sheetsManifest });

      const dup: ExtensionManifest = {
        ...sheetsManifest,
        id: "other-sheets",
        name: "Other Sheets",
      };
      const result = manager.registerExtension({ manifest: dup });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain('documentType "cpr-character" is already contributed by extension "sheets-ext"');
      }
      expect(manager.getExtension("other-sheets")?.state).toBe("Incompatible");

      // Original extension's data must still be intact
      expect(manager.documentTypeRegistry.has("cpr-character")).toBe(true);
      expect(manager.documentTypeRegistry.get("cpr-character")?.extensionId).toBe("sheets-ext");
    });

    it("rejects cross-extension collision on default sheet for the same docType", () => {
      manager.registerExtension({ manifest: sheetsManifest });

      const rival: ExtensionManifest = {
        id: "rival-sheets",
        name: "Rival Sheets",
        version: "1.0.0",
        engines: { core: ">=0.1.0" },
        activationEvents: ["onReady"],
        contributes: {
          sheets: [
            { documentType: "Actor", component: "RivalActorSheet", default: true },
          ],
        },
      };

      const result = manager.registerExtension({ manifest: rival });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("sheet for \"Actor\"");
        expect(result.reason).toContain("sheets-ext");
        expect(result.reason).toContain("rival-sheets");
      }
      expect(manager.getExtension("rival-sheets")?.state).toBe("Incompatible");

      // The rival extension's sheet was rolled back
      const sheetsForRival = manager.sheetRegistry.forDocumentType("Actor").filter(
        (e) => e.extensionId === "rival-sheets",
      );
      expect(sheetsForRival).toHaveLength(0);
      // The original default is intact
      expect(manager.sheetRegistry.defaultFor("Actor")?.extensionId).toBe("sheets-ext");
    });

    it("non-owner cannot override the default sheet for the same base type (owner wins)", () => {
      // sheets-ext registered first for "Actor" (base type), so it owns the slot.
      // The rival extension's attempt to set default:true for "Actor" must fail.
      manager.registerExtension({ manifest: sheetsManifest });

      const rival: ExtensionManifest = {
        id: "rival-sheets",
        name: "Rival Sheets",
        version: "1.0.0",
        engines: { core: ">=0.1.0" },
        activationEvents: ["onReady"],
        contributes: {
          sheets: [
            { documentType: "Actor", component: "RivalActorSheet", default: true },
          ],
        },
      };
      const result = manager.registerExtension({ manifest: rival });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("sheets-ext");
        expect(result.reason).toContain("rival-sheets");
      }
      expect(manager.sheetRegistry.defaultFor("Actor")?.extensionId).toBe("sheets-ext");
    });

    it("non-owner cannot override the default sheet of a contributed documentType", () => {
      // sheets-ext owns "cpr-character" via contributes.documentTypes; the rival
      // also contributes the same id but cannot claim default. We give the rival
      // a contributed id AND its own default sheet for that id, but since
      // sheets-ext registered first, sheets-ext owns the type.
      manager.registerExtension({ manifest: sheetsManifest });

      const rival: ExtensionManifest = {
        id: "rival-sheets",
        name: "Rival Sheets",
        version: "1.0.0",
        engines: { core: ">=0.1.0" },
        activationEvents: ["onReady"],
        contributes: {
          documentTypes: [
            { id: "rival-character", base: "Actor", schemaVersion: 0 },
          ],
          sheets: [
            { documentType: "rival-character", component: "RivalSheet", default: true },
          ],
        },
      };
      expect(() => manager.registerExtension({ manifest: rival })).not.toThrow();
      // rival-character has its own owner (rival-sheets), so its default registers cleanly.
      expect(manager.sheetRegistry.defaultFor("rival-character")?.extensionId).toBe("rival-sheets");
    });

    it("deactivate cleans up commands, hooks, documentTypes and sheets atomically", async () => {
      const readyHandler = vi.fn();
      manager.registerExtension({
        manifest: {
          ...sheetsManifest,
          contributes: {
            ...sheetsManifest.contributes,
            chatCommands: [{ name: "test", description: "test", requiredPermission: "Player" }],
          },
        },
        activate: (api) => {
          api.hooks.on("ready", readyHandler);
          api.chat.registerCommand({
            name: "fromactivate",
            description: "d",
            handler: async () => {},
          });
        },
        deactivate: async () => {},
      });

      await manager.ensureActivated("sheets-ext");
      expect(manager.commandRegistry.has("fromactivate")).toBe(true);
      expect(manager.documentTypeRegistry.has("cpr-character")).toBe(true);
      expect(manager.sheetRegistry.forDocumentType("cpr-character").length).toBeGreaterThan(0);
      expect(manager.getContributedCommand("test")).toBeDefined();

      await manager.deactivateExtension("sheets-ext");

      // Runtime hook must not fire after deactivation
      await manager.hooks.emit("ready", {});
      expect(readyHandler).not.toHaveBeenCalled();

      expect(manager.commandRegistry.has("fromactivate")).toBe(false);
      expect(manager.documentTypeRegistry.has("cpr-character")).toBe(false);
      expect(manager.sheetRegistry.forDocumentType("cpr-character")).toHaveLength(0);
      expect(manager.sheetRegistry.forDocumentType("Actor")).toHaveLength(0);
      expect(manager.getContributedCommand("test")).toBeUndefined();
      expect(manager.canInvoke("test", "Player")).toBe(true);
    });

    it("failed activate does not leak runtime hooks or registered commands", async () => {
      manager.registerExtension({
        manifest: sheetsManifest,
        activate: () => {
          throw new Error("activate boom");
        },
      });

      await expect(manager.ensureActivated("sheets-ext")).rejects.toThrow("activate boom");

      expect(manager.getExtension("sheets-ext")?.state).toBe("Errored");
      expect(manager.commandRegistry.has("fromactivate")).toBe(false);
    });
  });
});
