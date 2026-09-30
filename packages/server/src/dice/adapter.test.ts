import { describe, it, expect } from "vitest";
import { rollDice, withTestEngine } from "./adapter";

function engine(values: number[]) {
  let i = 0;
  return { next() { const v = values[i++]; return v ?? 0; } };
}

describe("rollDice", () => {
  it("2d20kh1+5 with [12,7] yields total 17 and keeps the highest", () => {
    const result = withTestEngine(engine([11, 6]), () => rollDice("2d20kh1+5"));
    expect(result.total).toBe(17);
    expect(result.modifier).toBe(5);
    const term = result.terms[0];
    expect(term).toBeDefined();
    if (term) {
      expect(term.rolls).toEqual([12, 7]);
      expect(term.kept).toEqual([12]);
      expect(term.dropped).toEqual([7]);
      expect(term.subtotal).toBe(12);
    }
  });

  it("4dF with {-1,0,+1,-1} yields breakdown with subtotal -1", () => {
    // Library maps next()%3 = 0 → -1, 1 → 0, 2 → +1.
    const result = withTestEngine(engine([0, 1, 2, 0]), () => rollDice("4dF"));
    expect(result.total).toBe(-1);
    expect(result.terms).toHaveLength(1);
    const t = result.terms[0];
    if (t) {
      expect(t.rolls).toEqual([-1, 0, 1, -1]);
      expect(t.kept).toEqual([-1, 0, 1, -1]);
      expect(t.subtotal).toBe(-1);
    }
  });

  it("1d6kh1 keeps the single highest", () => {
    const result = withTestEngine(engine([3]), () => rollDice("1d6kh1"));
    expect(result.total).toBe(4);
  });

  it("1d20+1d6-3 sums two dice and a modifier", () => {
    // next()=19 → 20%6 = 2 → +1 = 3 in 1d20? Actually 1d20 rolls next()%20+1.
    // next()=80 → 80%20 = 0 → +1 = 1 for d20; next()=40 → 40%6=4 → +1=5 for d6.
    const result = withTestEngine(engine([80, 40]), () => rollDice("1d20+1d6-3"));
    expect(result.total).toBe(3);
    expect(result.modifier).toBe(-3);
  });

  it("rejects bad notation by throwing", () => {
    expect(() => rollDice("1000000d20")).toThrow();
    expect(() => rollDice("0d6")).toThrow();
    expect(() => rollDice("1d6kh2")).toThrow();
  });
});
