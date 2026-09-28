import { describe, it, expect } from "vitest";
import {
  validateDice,
  rollDice,
  withTestEngine,
  parseDiceTerms,
} from "./adapter";

function engine(values: number[]) {
  let i = 0;
  return { next() { const v = values[i++]; return v ?? 0; } };
}

describe("validateDice", () => {
  it("accepts plain positive terms", () => {
    expect(validateDice("1d20")).toEqual({ ok: true });
    expect(validateDice("2d6+3")).toEqual({ ok: true });
    expect(validateDice("1d20+1d6-3")).toEqual({ ok: true });
  });

  it("rejects empty notation", () => {
    expect(validateDice("")).toEqual({ ok: false, reason: "bad-notation" });
    expect(validateDice("   ")).toEqual({ ok: false, reason: "bad-notation" });
  });

  it("rejects terms with zero dice", () => {
    expect(validateDice("0d6")).toEqual({ ok: false, reason: "invalid-keep" });
  });

  it("rejects too many dice per term", () => {
    expect(validateDice("1000000d20")).toEqual({ ok: false, reason: "dice-count-too-large" });
    expect(validateDice("101d20")).toEqual({ ok: false, reason: "dice-count-too-large" });
  });

  it("rejects faces larger than the cap", () => {
    expect(validateDice("1d10000")).toEqual({ ok: false, reason: "face-too-large" });
  });

  it("rejects invalid keep expressions", () => {
    expect(validateDice("1d6kh0")).toEqual({ ok: false, reason: "invalid-keep" });
    expect(validateDice("1d6kl0")).toEqual({ ok: false, reason: "invalid-keep" });
    expect(validateDice("1d6kh2")).toEqual({ ok: false, reason: "invalid-keep" });
  });

  it("accepts valid kh/kl", () => {
    expect(validateDice("4d6kh3")).toEqual({ ok: true });
    expect(validateDice("2d20kh1")).toEqual({ ok: true });
  });

  it("rejects more terms than the cap", () => {
    expect(validateDice("1d6+1d6+1d6+1d6+1d6+1d6+1d6+1d6+1d6+1d6+1d6")).toEqual({
      ok: false,
      reason: "too-many-terms",
    });
  });
});

describe("parseDiceTerms", () => {
  it("captures sign, count, sides, and kh/kl", () => {
    const t = parseDiceTerms("-2d20kh1");
    expect(t).toEqual([{ sign: -1, count: 2, sides: 20, kept: 1 }]);
  });

  it("defaults count to 1", () => {
    const t = parseDiceTerms("d20");
    expect(t).toEqual([{ sign: 1, count: 1, sides: 20 }]);
  });

  it("flags fudge dice", () => {
    const t = parseDiceTerms("4dF");
    expect(t).toEqual([{ sign: 1, count: 4, sides: 0, fudge: true }]);
  });
});

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
