import { describe, it, expect, beforeEach } from "vitest";
import {
  registerSheet,
  defaultSheetFor,
  sheetsFor,
  clearSheets,
  clearSheetsFor,
  listSheets,
} from "./clientSheets";
import type { ComponentType } from "preact";
import { SheetOwnerConflict } from "@rollforge/protocol";

const CompA: ComponentType<{ documentId: string }> = () => null;
const CompB: ComponentType<{ documentId: string }> = () => null;
const CompC: ComponentType<{ documentId: string }> = () => null;

describe("clientSheets registry", () => {
  beforeEach(() => clearSheets());

  it("starts empty", () => {
    expect(listSheets()).toHaveLength(0);
  });

  it("registers a sheet for a documentType", () => {
    registerSheet({ documentType: "Actor", component: CompA, default: true });
    expect(listSheets()).toHaveLength(1);
    expect(defaultSheetFor("Actor")?.component).toBe(CompA);
  });

  it("returns null default when no sheet registered for a type", () => {
    registerSheet({ documentType: "Actor", component: CompA });
    expect(defaultSheetFor("Item")).toBeNull();
  });

  it("only returns sheets for the requested documentType", () => {
    registerSheet({ documentType: "Actor", component: CompA });
    registerSheet({ documentType: "Item", component: CompB });
    const actorSheets = sheetsFor("Actor");
    expect(actorSheets).toHaveLength(1);
    expect(actorSheets[0]?.component).toBe(CompA);
  });

  it("allows multiple sheets for the same documentType (variants), default picks the marked one", () => {
    registerSheet({ documentType: "Actor", component: CompA, default: true });
    registerSheet({ documentType: "Actor", component: CompB });
    expect(sheetsFor("Actor")).toHaveLength(2);
    expect(defaultSheetFor("Actor")?.component).toBe(CompA);
  });

  it("anonymous re-registration of default swaps the default in place (same owner)", () => {
    registerSheet({ documentType: "Actor", component: CompA, default: true });
    registerSheet({ documentType: "Actor", component: CompB, default: true });
    expect(defaultSheetFor("Actor")?.component).toBe(CompB);
    expect(sheetsFor("Actor")).toHaveLength(1);
  });

  it("owner extension can re-register its own default silently (HMR-style reload)", () => {
    registerSheet({ documentType: "Actor", component: CompA, default: true, extensionId: "core" });
    registerSheet({ documentType: "Actor", component: CompB, default: true, extensionId: "core" });
    expect(defaultSheetFor("Actor")?.component).toBe(CompB);
    expect(sheetsFor("Actor")).toHaveLength(1);
  });

  it("non-owner extension trying to set default:true throws SheetOwnerConflict", () => {
    registerSheet({ documentType: "Actor", component: CompA, default: true, extensionId: "core" });
    let caught: unknown;
    try {
      registerSheet({ documentType: "Actor", component: CompB, default: true, extensionId: "rival" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SheetOwnerConflict);
    const conflict = caught as SheetOwnerConflict;
    expect(conflict.documentType).toBe("Actor");
    expect(conflict.owner).toBe("core");
    expect(conflict.attemptedBy).toBe("rival");
    expect(defaultSheetFor("Actor")?.component).toBe(CompA);
    expect(sheetsFor("Actor").filter((s) => s.extensionId === "rival")).toHaveLength(0);
  });

  it("anonymous cannot override an owned default:true", () => {
    registerSheet({ documentType: "Actor", component: CompA, default: true, extensionId: "core" });
    let caught: unknown;
    try {
      registerSheet({ documentType: "Actor", component: CompB, default: true });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SheetOwnerConflict);
    expect((caught as SheetOwnerConflict).attemptedBy).toBe("");
    expect(defaultSheetFor("Actor")?.component).toBe(CompA);
  });

  it("clearSheets wipes all entries and ownership", () => {
    registerSheet({ documentType: "Actor", component: CompA, default: true, extensionId: "core" });
    registerSheet({ documentType: "Item", component: CompB });
    clearSheets();
    expect(listSheets()).toHaveLength(0);
    expect(defaultSheetFor("Actor")).toBeNull();
    // After full clear, an anonymous can claim "Actor" again
    registerSheet({ documentType: "Actor", component: CompC, default: true });
    expect(defaultSheetFor("Actor")?.component).toBe(CompC);
  });

  it("clearSheetsFor removes all entries for an extension, leaves others", () => {
    registerSheet({ documentType: "Actor", component: CompA, extensionId: "a" });
    registerSheet({ documentType: "Item", component: CompB, extensionId: "b" });
    clearSheetsFor("a");
    expect(sheetsFor("Actor")).toHaveLength(0);
    expect(sheetsFor("Item")).toHaveLength(1);
  });

  it("clearSheetsFor restores the previous default when the override is undone", () => {
    registerSheet({ documentType: "Actor", component: CompA, default: true, extensionId: "core" });
    registerSheet({ documentType: "Actor", component: CompB, default: true, extensionId: "core" });
    expect(defaultSheetFor("Actor")?.component).toBe(CompB);
    clearSheetsFor("core");
    expect(defaultSheetFor("Actor")?.component).toBe(CompA);
  });

  it("clearSheetsFor transfers ownership to the restored entry's extensionId", () => {
    // ext-a owns the default, then ext-a overrides its own (saving the older
    // version), then ext-a deactivates. The older version (still by ext-a)
    // is restored, and ownership stays with ext-a since the restored entry
    // also belongs to ext-a. A subsequent ext-b default:true still throws.
    registerSheet({ documentType: "Actor", component: CompA, default: true, extensionId: "ext-a" });
    registerSheet({ documentType: "Actor", component: CompB, default: true, extensionId: "ext-a" });
    clearSheetsFor("ext-a");
    expect(defaultSheetFor("Actor")?.component).toBe(CompA);
    let caught: unknown;
    try {
      registerSheet({ documentType: "Actor", component: CompC, default: true, extensionId: "ext-b" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SheetOwnerConflict);
    expect((caught as SheetOwnerConflict).owner).toBe("ext-a");
  });

  it("clearSheetsFor drops ownership when the only entry was the owner's own (no prior default)", () => {
    registerSheet({ documentType: "Actor", component: CompA, default: true, extensionId: "core" });
    clearSheetsFor("core");
    // No entries left; ownership cleared; anonymous can claim again
    registerSheet({ documentType: "Actor", component: CompB, default: true });
    expect(defaultSheetFor("Actor")?.component).toBe(CompB);
  });
});