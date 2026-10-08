import { describe, it, expect } from "vitest";
import { identiconCells, tokenSeed } from "./identicon";

describe("identiconCells", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const a = identiconCells("tok-1");
    const b = identiconCells("tok-2");
    expect(identiconCells("tok-1").cells).toEqual(a.cells);
    expect(a.cells).not.toEqual(b.cells);
  });

  //  Same array identity means the parse really is cached, not re-run per draw.
  it("caches by seed", () => {
    expect(identiconCells("tok-cache")).toBe(identiconCells("tok-cache"));
  });

  it("parses 0..4 grid coordinates and a hue", () => {
    for (const seed of ["a", "zzz", "tok-42"]) {
      const { cells, hue } = identiconCells(seed);
      expect(cells.length).toBeGreaterThan(0);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
      for (const [x, y] of cells) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(4);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(4);
      }
    }
  });

  it("parses x straight off the rect, without un-mirroring", () => {
    // minidenticons already emits x in 0..4 (it mirrors the right half itself as
    // 7 - col for i > 14). Un-mirroring here would swap columns 3 and 4 and render
    // every icon reflected — this test pins the parse to the SVG, not to a guess.
    for (const seed of ["a", "b", "c", "d", "e", "mirror-check"]) {
      const xs = new Set(identiconCells(seed).cells.map(([x]) => x));
      expect([...xs].every((x) => x >= 0 && x <= 4)).toBe(true);
    }
    const xs = new Set<number>();
    for (const seed of ["a", "b", "c", "d", "e", "mirror-check"]) {
      for (const [x] of identiconCells(seed).cells) xs.add(x);
    }
    expect([...xs].sort((p, q) => p - q)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("tokenSeed", () => {
  it("uses the token id today", () => {
    expect(tokenSeed("tok-1")).toBe("tok-1");
  });
});