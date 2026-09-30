import { describe, it, expect } from "vitest";
import { validateDice, parseDiceTerms, DICE_LIMITS } from "./dice";

describe("validateDice", () => {
  it("accepts plain positive terms", () => {
    expect(validateDice("1d20")).toEqual({ ok: true });
    expect(validateDice("2d6+3")).toEqual({ ok: true });
    expect(validateDice("1d20+1d6-3")).toEqual({ ok: true });
    expect(validateDice("d100")).toEqual({ ok: true });
    expect(validateDice("4dF")).toEqual({ ok: true });
  });

  it("rejects empty notation", () => {
    expect(validateDice("")).toEqual({ ok: false, reason: "bad-notation" });
    expect(validateDice("   ")).toEqual({ ok: false, reason: "bad-notation" });
  });

  it("rejects notation over the length cap", () => {
    const long = "1d6+".repeat(DICE_LIMITS.MAX_NOTATION_LEN);
    expect(validateDice(long)).toEqual({ ok: false, reason: "bad-notation" });
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
    expect(validateDice("4d6kl1")).toEqual({ ok: true });
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
    expect(parseDiceTerms("-2d20kh1")).toEqual([{ sign: -1, count: 2, sides: 20, kept: 1 }]);
  });

  it("defaults count to 1", () => {
    expect(parseDiceTerms("d20")).toEqual([{ sign: 1, count: 1, sides: 20 }]);
  });

  it("flags fudge dice", () => {
    expect(parseDiceTerms("4dF")).toEqual([{ sign: 1, count: 4, sides: 0, fudge: true }]);
  });

  it("converts kl to a kept count", () => {
    expect(parseDiceTerms("4d6kl1")).toEqual([{ sign: 1, count: 4, sides: 6, kept: 3 }]);
  });

  it("splits multiple terms", () => {
    expect(parseDiceTerms("1d20+1d6-3")).toEqual([
      { sign: 1, count: 1, sides: 20 },
      { sign: 1, count: 1, sides: 6 },
    ]);
  });
});
