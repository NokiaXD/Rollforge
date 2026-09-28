import { describe, it, expect } from "vitest";
import type { DiceResult, DiceRoll, RollActor, RollActorRef } from "./dice";

describe("DiceRoll (type-level)", () => {
  it("accepts a basic positive d20", () => {
    const r: DiceRoll = { sign: 1, count: 1, sides: 20 };
    expect(r.sign).toBe(1);
    expect(r.count).toBe(1);
    expect(r.sides).toBe(20);
  });

  it("accepts a fudge roll", () => {
    const r: DiceRoll = { sign: -1, count: 4, sides: 0, kept: 2, fudge: true };
    expect(r.fudge).toBe(true);
  });

  it("accepts kh/kl keep variants", () => {
    const kh: DiceRoll = { sign: 1, count: 4, sides: 6, kept: 3 };
    const kl: DiceRoll = { sign: 1, count: 4, sides: 6, kept: 2 };
    expect(kh.kept).toBe(3);
    expect(kl.kept).toBe(2);
  });
});

describe("DiceResult (shape)", () => {
  it("serializes a typical breakdown", () => {
    const result: DiceResult = {
      notation: "2d20kh1+5",
      terms: [
        {
          roll: { sign: 1, count: 2, sides: 20, kept: 1 },
          rolls: [12, 7],
          kept: [12],
          dropped: [7],
          subtotal: 12,
        },
      ],
      modifier: 5,
      total: 17,
    };
    expect(result.total).toBe((result.terms[0]?.subtotal ?? 0) + result.modifier);
  });
});

describe("RollActor variants", () => {
  it("user ref carries no extra fields", () => {
    const ref: RollActorRef = { type: "user" };
    expect(ref.type).toBe("user");
    expect(ref.type === "user" ? ref.type : "other").toBe("user");
  });

  it("character ref carries characterId", () => {
    const ref: RollActorRef = { type: "character", characterId: "char_1" };
    expect(ref.type).toBe("character");
    if (ref.type === "character") expect(ref.characterId).toBe("char_1");
  });

  it("snapshot persists name + id", () => {
    const a: RollActor = { type: "user", userId: "u1", name: "alice" };
    const b: RollActor = { type: "character", characterId: "c1", name: "Goblin" };
    expect(a.name).toBe("alice");
    expect(b.name).toBe("Goblin");
  });
});
