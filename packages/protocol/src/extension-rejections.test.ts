import { describe, it, expect } from "vitest";
import { SheetOwnerConflict, isSheetOwnerConflict } from "./extension-rejections";

describe("SheetOwnerConflict", () => {
  it("carries structured fields { documentType, owner, attemptedBy }", () => {
    const conflict = new SheetOwnerConflict("cpr-character", "sheets-ext", "rival-sheets");
    expect(conflict.documentType).toBe("cpr-character");
    expect(conflict.owner).toBe("sheets-ext");
    expect(conflict.attemptedBy).toBe("rival-sheets");
    expect(conflict.kind).toBe("SheetOwnerConflict");
    expect(conflict.name).toBe("SheetOwnerConflict");
  });

  it("renders the same human message regardless of empty owner or attemptedBy", () => {
    const conflict = new SheetOwnerConflict("Actor", "", "rival");
    expect(conflict.message).toBe(
      'sheet for documentType "Actor" is owned by "<unnamed>"; "rival" cannot override',
    );
  });

  it("isSheetOwnerConflict narrows by class identity", () => {
    const conflict = new SheetOwnerConflict("Actor", "core", "rival");
    expect(isSheetOwnerConflict(conflict)).toBe(true);
    expect(isSheetOwnerConflict(new Error("boom"))).toBe(false);
    expect(isSheetOwnerConflict(null)).toBe(false);
  });
});