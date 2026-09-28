import { describe, expect, it } from "vitest";
import { applyEvent, tokens, upsertToken, type Token } from "./scene";

const baseToken = (overrides: Partial<Token> = {}): Token => ({
  id: "t1",
  sceneId: "default",
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  _rev: 1,
  ...overrides,
});

describe("applyEvent", () => {
  it("applies a fresh TokenPositionDiff", () => {
    tokens.value = new Map([["t1", baseToken()]]);
    applyEvent({ type: "TokenPositionDiff", tokenId: "t1", x: 10, y: 20, _rev: 2 });
    expect(tokens.value.get("t1")?.x).toBe(10);
    expect(tokens.value.get("t1")?._rev).toBe(2);
  });

  it("ignores a stale TokenPositionDiff (AGENTS.md: never bump _rev outside moveToken)", () => {
    tokens.value = new Map([["t1", baseToken({ _rev: 5 })]]);
    applyEvent({ type: "TokenPositionDiff", tokenId: "t1", x: 999, y: 999, _rev: 3 });
    expect(tokens.value.get("t1")?.x).toBe(0);
    expect(tokens.value.get("t1")?._rev).toBe(5);
  });

  it("acquires and releases drag locks", () => {
    tokens.value = new Map();
    upsertToken(baseToken());
    applyEvent({ type: "DragLockAcquired", tokenId: "t1", ownerId: "u1" });
    expect([...tokens.value]).toHaveLength(1);
    applyEvent({ type: "DragLockReleased", tokenId: "t1" });
    expect([...tokens.value]).toHaveLength(1);
  });
});