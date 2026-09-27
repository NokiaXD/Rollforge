import { describe, it, expect } from "vitest";
import type { Document, OwnershipLevel } from "./documents.js";

describe("OwnershipLevel", () => {
  it("accepts the four documented levels", () => {
    const levels: OwnershipLevel[] = ["NONE", "LIMITED", "OBSERVER", "OWNER"];
    expect(levels).toHaveLength(4);
  });
});

describe("Document", () => {
  it("compiles with a typed system payload", () => {
    const doc: Document<{ hp: number }> = {
      id: "a1",
      type: "Actor",
      name: "Goblin",
      system: { hp: 7 },
      flags: {},
      ownership: { default: "NONE" },
      _rev: 0,
    };
    expect(doc.system.hp).toBe(7);
    expect(doc._rev).toBe(0);
  });
});