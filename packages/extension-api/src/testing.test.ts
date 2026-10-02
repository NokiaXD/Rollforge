import { describe, it, expect } from "vitest";
import { runMigration, runChain } from "./testing";

describe("runMigration", () => {
  it("returns the result of a sync up", async () => {
    const r = await runMigration<{ hp: number }>((s) => ({ hp: s.hp + 1 }), { hp: 5 });
    expect(r.hp).toBe(6);
  });

  it("awaits an async up", async () => {
    const r = await runMigration<{ hp: number }>(async (s) => ({ hp: s.hp + 10 }), { hp: 5 });
    expect(r.hp).toBe(15);
  });
});

describe("runChain", () => {
  it("runs each step contiguously and reaches targetVersion", async () => {
    const chain = [
      { from: 1, to: 2, up: (s: { hp: number }) => ({ hp: s.hp + 1 }) },
      { from: 2, to: 3, up: (s: { hp: number }) => ({ hp: s.hp * 2 }) },
    ];
    const out = await runChain<{ hp: number }>(chain, { hp: 5 }, 1, 3);
    expect(out.hp).toBe(12); // 5+1=6, 6*2=12
  });

  it("throws on a hole in the chain", async () => {
    const chain = [
      { from: 1, to: 3, up: (s: { hp: number }) => ({ hp: s.hp + 1 }) },
    ];
    await expect(runChain(chain, { hp: 5 }, 1, 3)).rejects.toThrow(/not a single-version bump/);
  });

  it("throws when a step does not start at the current version", async () => {
    const chain = [
      { from: 1, to: 2, up: (s: { hp: number }) => ({ hp: s.hp + 1 }) },
    ];
    await expect(runChain(chain, { hp: 5 }, 0, 2)).rejects.toThrow(/does not start at current 0/);
  });
});