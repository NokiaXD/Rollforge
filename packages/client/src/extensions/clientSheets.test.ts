import { describe, it, expect, beforeEach } from "vitest";
import {
  registerSheet,
  defaultSheetFor,
  sheetsFor,
  clearSheets,
  clearSheetsFor,
  listSheets,
  setOwnerMap,
} from "./clientSheets";
import type { ComponentType } from "preact";
import { SheetOwnerConflict } from "@rollforge/protocol";

const CompA: ComponentType<{ documentId: string }> = () => null;
const CompB: ComponentType<{ documentId: string }> = () => null;
const CompC: ComponentType<{ documentId: string }> = () => null;

//  Base types are pre-seeded in clientSheets (BASE_TYPE_OWNERS). Tests that
// need to start from an "anonymous, nothing declared" state use
// `clearSheets()` (which wipes and re-seeds the base owners back) — this
// matches the documented contract that base types are always owned by core.
describe("clientSheets registry", () => {
  beforeEach(() => clearSheets());

  it("starts with no sheets (base types are owned but have no sheet registered)", () => {
    expect(listSheets()).toHaveLength(0);
  });

  it("registers a sheet for a documentType", () => {
    registerSheet({
      documentType: "Actor",
      component: CompA,
      default: true,
      extensionId: "core:custom-actor-sheet",
    });
    expect(listSheets()).toHaveLength(1);
    expect(defaultSheetFor("Actor")?.component).toBe(CompA);
  });

  it("returns null default when no sheet registered for a type", () => {
    registerSheet({
      documentType: "Actor",
      component: CompA,
      extensionId: "core:custom-actor-sheet",
    });
    expect(defaultSheetFor("Item")).toBeNull();
  });

  it("only returns sheets for the requested documentType", () => {
    registerSheet({ documentType: "Actor", component: CompA, extensionId: "core" });
    registerSheet({ documentType: "Item", component: CompB, extensionId: "core" });
    const actorSheets = sheetsFor("Actor");
    expect(actorSheets).toHaveLength(1);
    expect(actorSheets[0]?.component).toBe(CompA);
  });

  it("allows multiple sheets for the same documentType (variants), default picks the marked one", () => {
    registerSheet({
      documentType: "Actor",
      component: CompA,
      default: true,
      extensionId: "core:custom-actor-sheet",
    });
    registerSheet({
      documentType: "Actor",
      component: CompB,
      extensionId: "core:custom-actor-sheet",
    });
    expect(sheetsFor("Actor")).toHaveLength(2);
    expect(defaultSheetFor("Actor")?.component).toBe(CompA);
  });

  it("base type Actor is owned by core:custom-actor-sheet without setOwnerMap", () => {
    // No setOwnerMap call. The seed should already allow this registration.
    expect(() =>
      registerSheet({
        documentType: "Actor",
        component: CompA,
        default: true,
        extensionId: "core:custom-actor-sheet",
      }),
    ).not.toThrow();
    expect(defaultSheetFor("Actor")?.component).toBe(CompA);
  });

  it("owner extension can re-register its own default silently (HMR-style reload)", () => {
    registerSheet({
      documentType: "Actor",
      component: CompA,
      default: true,
      extensionId: "core:custom-actor-sheet",
    });
    registerSheet({
      documentType: "Actor",
      component: CompB,
      default: true,
      extensionId: "core:custom-actor-sheet",
    });
    expect(defaultSheetFor("Actor")?.component).toBe(CompB);
    expect(sheetsFor("Actor")).toHaveLength(1);
  });

  it("non-owner extension trying to set default:true throws SheetOwnerConflict", () => {
    setOwnerMap({ "example-character": "example-rpg" });
    registerSheet({
      documentType: "example-character",
      component: CompA,
      default: true,
      extensionId: "example-rpg",
    });
    let caught: unknown;
    try {
      registerSheet({
        documentType: "example-character",
        component: CompB,
        default: true,
        extensionId: "rival",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SheetOwnerConflict);
    const conflict = caught as SheetOwnerConflict;
    expect(conflict.documentType).toBe("example-character");
    expect(conflict.owner).toBe("example-rpg");
    expect(conflict.attemptedBy).toBe("rival");
    expect(defaultSheetFor("example-character")?.component).toBe(CompA);
  });

  it("default:true for a type the server never registered throws SheetOwnerConflict", () => {
    // The owner table only knows about base types until setOwnerMap runs.
    setOwnerMap({});
    let caught: unknown;
    try {
      registerSheet({
        documentType: "unknown-type",
        component: CompA,
        default: true,
        extensionId: "anybody",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SheetOwnerConflict);
    const conflict = caught as SheetOwnerConflict;
    expect(conflict.documentType).toBe("unknown-type");
    expect(conflict.owner).toBe("");
    expect(conflict.attemptedBy).toBe("anybody");
  });

  it("variants (default: undefined) do not check owner, accumulate freely", () => {
    setOwnerMap({ "example-character": "example-rpg" });
    registerSheet({
      documentType: "example-character",
      component: CompA,
      extensionId: "anyone",
    });
    registerSheet({
      documentType: "example-character",
      component: CompB,
      extensionId: "someone-else",
    });
    expect(sheetsFor("example-character")).toHaveLength(2);
  });

  it("setOwnerMap merges — never wipes base type owners", () => {
    // Without setOwnerMap, base types are pre-owned.
    setOwnerMap({ "example-character": "example-rpg" });
    // Actor is still owned by core, even after a fresh setOwnerMap call.
    expect(() =>
      registerSheet({
        documentType: "Actor",
        component: CompA,
        default: true,
        extensionId: "core:custom-actor-sheet",
      }),
    ).not.toThrow();
  });

  it("setOwnerMap is idempotent and last-write wins per type", () => {
    setOwnerMap({ "alpha-doc": "ext-a" });
    setOwnerMap({ "alpha-doc": "ext-b" });
    let caught: unknown;
    try {
      registerSheet({
        documentType: "alpha-doc",
        component: CompA,
        default: true,
        extensionId: "ext-a",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SheetOwnerConflict);
    expect((caught as SheetOwnerConflict).owner).toBe("ext-b");
  });

  it("clearSheetsFor restores the previous default without touching ownerByType", () => {
    setOwnerMap({ Actor: "core:custom-actor-sheet" });
    registerSheet({
      documentType: "Actor",
      component: CompA,
      default: true,
      extensionId: "core:custom-actor-sheet",
    });
    registerSheet({
      documentType: "Actor",
      component: CompB,
      default: true,
      extensionId: "core:custom-actor-sheet",
    });
    expect(defaultSheetFor("Actor")?.component).toBe(CompB);

    clearSheetsFor("core:custom-actor-sheet");
    expect(defaultSheetFor("Actor")?.component).toBe(CompA);

    // The ownerByType entry is intact — the same owner can re-register.
    expect(() =>
      registerSheet({
        documentType: "Actor",
        component: CompC,
        default: true,
        extensionId: "core:custom-actor-sheet",
      }),
    ).not.toThrow();
  });

  it("clearSheetsFor wipes only this extension's entries, leaves others", () => {
    setOwnerMap({ "example-character": "example-rpg" });
    registerSheet({ documentType: "Actor", component: CompA, extensionId: "a" });
    registerSheet({ documentType: "Item", component: CompB, extensionId: "b" });
    clearSheetsFor("a");
    expect(sheetsFor("Actor")).toHaveLength(0);
    expect(sheetsFor("Item")).toHaveLength(1);
  });

  it("clearSheets wipes all sheets but preserves base type ownership", () => {
    registerSheet({
      documentType: "Actor",
      component: CompA,
      default: true,
      extensionId: "core:custom-actor-sheet",
    });
    clearSheets();
    expect(listSheets()).toHaveLength(0);
    // Base type ownership survives a clear (the seed is restored).
    expect(() =>
      registerSheet({
        documentType: "Actor",
        component: CompB,
        default: true,
        extensionId: "core:custom-actor-sheet",
      }),
    ).not.toThrow();
  });
});