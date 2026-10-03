import { describe, expect, it } from "vitest";
import { applyEvent, cellSize, focusedTokenId, locks, tokenAt, tokens, upsertToken, type Token } from "./scene";

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
  it("TokenDeleted drops the token, its lock and its focus", () => {
    tokens.value = new Map([["t1", baseToken()]]);
    locks.value = new Map([["t1", "u1"]]);
    focusedTokenId.value = "t1";
    applyEvent({ type: "TokenDeleted", sceneId: "default", tokenId: "t1" });
    expect(tokens.value.has("t1")).toBe(false);
    expect(locks.value.has("t1")).toBe(false);
    expect(focusedTokenId.value).toBeNull();
  });
});

describe("tokenAt", () => {
  it("hits inside the cell rect, misses outside, last match wins", () => {
    cellSize.value = 50;
    tokens.value = new Map([
      ["t1", baseToken({ id: "t1", x: 0, y: 0 })],
      ["t2", baseToken({ id: "t2", x: 0, y: 0 })],
    ]);
    expect(tokenAt(24, 24)?.id).toBe("t2");
    expect(tokenAt(0, 0)?.id).toBe("t2");
    expect(tokenAt(26, 0)).toBeNull();
  });
});