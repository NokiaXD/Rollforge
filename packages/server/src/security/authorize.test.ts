import { describe, it, expect } from "vitest";
import type { Document, OwnershipLevel } from "@rollforge/protocol";
import {
  authorize,
  authorizeAction,
  canRollAsCharacter,
  levelSatisfies,
  requiredLevelFor,
} from "./authorize";

function docWith(ownership: Document<unknown>["ownership"]): Document<unknown> {
  return {
    id: "d1",
    type: "Token",
    name: "t",
    system: {},
    flags: {},
    ownership,
    _rev: 0,
  };
}

describe("levelSatisfies", () => {
  it("orders ownership ranks correctly", () => {
    expect(levelSatisfies("NONE", "LIMITED")).toBe(false);
    expect(levelSatisfies("LIMITED", "LIMITED")).toBe(true);
    expect(levelSatisfies("LIMITED", "OBSERVER")).toBe(true);
    expect(levelSatisfies("OWNER", "LIMITED")).toBe(true);
  });
});

describe("requiredLevelFor", () => {
  it("returns LIMITED for token mutations", () => {
    expect(requiredLevelFor("MoveToken")).toBe("LIMITED");
    expect(requiredLevelFor("AcquireDragLock")).toBe("LIMITED");
    expect(requiredLevelFor("ReleaseDragLock")).toBe("LIMITED");
  });
});

describe("authorize", () => {
  const levels: OwnershipLevel[] = ["NONE", "LIMITED", "OBSERVER", "OWNER"];

  it("returns true for GM regardless of ownership", () => {
    const doc = docWith({});
    for (const action of ["MoveToken", "AcquireDragLock", "ReleaseDragLock"] as const) {
      expect(authorize("any-user", action, doc, true)).toBe(true);
    }
  });

  it("rejects Player with no ownership and no default", () => {
    const doc = docWith({});
    expect(authorize("alice", "MoveToken", doc, false)).toBe(false);
  });

  it("allows Player via explicit user ownership", () => {
    const doc = docWith({ alice: "OWNER" });
    expect(authorize("alice", "MoveToken", doc, false)).toBe(true);
  });

  it("allows Player via default ownership", () => {
    const doc = docWith({ default: "LIMITED" });
    expect(authorize("stranger", "MoveToken", doc, false)).toBe(true);
  });

  it("rejects Player with explicit NONE ownership", () => {
    const doc = docWith({ alice: "NONE" });
    expect(authorize("alice", "MoveToken", doc, false)).toBe(false);
  });

  it("OBSERVER cannot MoveToken (action needs LIMITED)", () => {
    const doc = docWith({ alice: "OBSERVER" });
    expect(authorize("alice", "MoveToken", doc, false)).toBe(false);
  });

  it("per-user entry beats default", () => {
    const doc = docWith({ default: "LIMITED", alice: "NONE" });
    expect(authorize("alice", "MoveToken", doc, false)).toBe(false);
    expect(authorize("bob", "MoveToken", doc, false)).toBe(true);
  });

  it("covers all (level, isGM) combinations without throwing", () => {
    const doc = docWith({});
    for (const lvl of levels) {
      for (const action of ["MoveToken", "AcquireDragLock", "ReleaseDragLock"] as const) {
        expect(typeof authorize("u", action, { ...doc, ownership: { default: lvl } }, false)).toBe("boolean");
      }
    }
  });
});

describe("authorizeAction (chat, no document)", () => {
  it("returns true for any authenticated user (placeholder until hooks)", () => {
    expect(authorizeAction("u", "SendChatMessage", false)).toBe(true);
    expect(authorizeAction("u", "SendWhisper", false)).toBe(true);
  });

  it("returns true for GM", () => {
    expect(authorizeAction("u", "SendChatMessage", true)).toBe(true);
  });
});

describe("canRollAsCharacter", () => {
  it("GM can roll as anyone", () => {
    expect(canRollAsCharacter("u", null, true)).toBe(true);
    expect(canRollAsCharacter("u", docWith({}), true)).toBe(true);
  });

  it("returns false when the character doc is missing (and user is not GM)", () => {
    expect(canRollAsCharacter("u", null, false)).toBe(false);
  });

  it("requires OWNER for Players", () => {
    expect(canRollAsCharacter("u", docWith({ u: "OWNER" }), false)).toBe(true);
    expect(canRollAsCharacter("u", docWith({ u: "LIMITED" }), false)).toBe(false);
    expect(canRollAsCharacter("u", docWith({ default: "OWNER" }), false)).toBe(true);
  });
});