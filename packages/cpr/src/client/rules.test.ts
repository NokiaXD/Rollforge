import { describe, expect, it } from "vitest";

import {
  POINT_POOL,
  STAT_KEYS,
  STAT_MIN,
  canSeeDraft,
  cprFlags,
  derived,
  derivedCombat,
  derivedSkills,
  initialSkills,
  isDraft,
  publishPatch,
  skillBase,
} from "./rules";

const draft = { flags: { cpr: { status: "draft", owner: "u1" } } };
const published = { flags: { cpr: { status: "published", owner: "u1" } } };

describe("draft visibility and flags", () => {
  it("treats a missing or unnamespaced status as draft", () => {
    expect(isDraft({ flags: {} })).toBe(true);
    expect(isDraft({ flags: { cpr: {} } })).toBe(true);
    expect(isDraft(published)).toBe(false);
  });

  it("reads the flags namespace without throwing on junk", () => {
    expect(cprFlags({ flags: { cpr: "nope" } })).toEqual({});
    expect(cprFlags(null)).toEqual({});
  });

  it("hides a draft from everyone but its author and the GM", () => {
    expect(canSeeDraft(draft, "u2", false)).toBe(false);
    expect(canSeeDraft(draft, "u1", false)).toBe(true);
    expect(canSeeDraft(draft, "u2", true)).toBe(true);
  });

  it("shows a published character to anyone", () => {
    expect(canSeeDraft(published, "u2", false)).toBe(true);
  });

  it("publishPatch sets status to published", () => {
    expect(publishPatch()).toEqual({ "flags.cpr.status": "published" });
  });
});

describe("derived stats & pool", () => {
  it("defaults undefined stats to STAT_MIN (1) and calculates budget", () => {
    const d = derived({});
    for (const key of STAT_KEYS) {
      expect(d.stats[key]).toBe(STAT_MIN);
    }
    expect(d.spent).toBe(10 * STAT_MIN);
    expect(d.left).toBe(POINT_POOL - 10 * STAT_MIN);
  });

  it("calculates spent as total sum of all stats", () => {
    // 10 stats at 6 = 60 spent, 2 left of 62
    const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, 6]));
    const d = derived(stats);
    expect(d.spent).toBe(60);
    expect(d.left).toBe(2);
  });

  it("clamps stat values into 1..15 and ignores NaN", () => {
    const d = derived({
      tco: 99,
      fri: -4,
      des: "siete" as unknown as number,
      int: null as unknown as number,
      emp: 6.6,
      mov: 0,
    });
    expect(d.stats["tco"]).toBe(15);
    expect(d.stats["fri"]).toBe(1);
    expect(d.stats["des"]).toBe(1);
    expect(d.stats["int"]).toBe(1);
    expect(d.stats["emp"]).toBe(7);
    expect(d.stats["mov"]).toBe(1);
  });
});

describe("derivedCombat", () => {
  it("calculates Max HP from TCO and VOL: 10 + 5 * ceil((TCO + VOL) / 2)", () => {
    // TCO 6, VOL 6 -> avg 6 -> 10 + 5*6 = 40 HP
    const c1 = derivedCombat({ tco: 6, vol: 6 });
    expect(c1.maxHp).toBe(40);
    expect(c1.seriouslyWounded).toBe(20);
    expect(c1.deathSave).toBe(6);

    // TCO 5, VOL 6 -> avg 5.5 -> ceil is 6 -> 10 + 5*6 = 40 HP
    const c2 = derivedCombat({ tco: 5, vol: 6 });
    expect(c2.maxHp).toBe(40);
    expect(c2.seriouslyWounded).toBe(20);
    expect(c2.deathSave).toBe(5);

    // TCO 2, VOL 2 -> avg 2 -> 10 + 5*2 = 20 HP
    const c3 = derivedCombat({ tco: 2, vol: 2 });
    expect(c3.maxHp).toBe(20);
    expect(c3.seriouslyWounded).toBe(10);
    expect(c3.deathSave).toBe(2);
  });

  it("calculates Max Humanity as EMP * 10", () => {
    expect(derivedCombat({ emp: 7 }).maxHumanity).toBe(70);
    expect(derivedCombat({ emp: 3 }).maxHumanity).toBe(30);
  });

  it("falls back to STAT_MIN when stats are missing", () => {
    const c = derivedCombat({});
    // TCO 1, VOL 1 -> 10 + 5*1 = 15 HP
    expect(c.maxHp).toBe(15);
    expect(c.deathSave).toBe(1);
    expect(c.maxHumanity).toBe(10);
  });
});

describe("skillBase", () => {
  it("sums linked stat and skill level", () => {
    expect(skillBase(8, 6)).toBe(14);
    expect(skillBase(6, 2)).toBe(8);
    expect(skillBase(5, 0)).toBe(5);
  });

  it("handles missing or invalid inputs gracefully", () => {
    expect(skillBase(undefined, 4)).toBe(4);
    expect(skillBase(7, undefined)).toBe(7);
    expect(skillBase(NaN, -2)).toBe(0);
  });
});

describe("derivedSkills", () => {
  it("seeds basic skills at 2 and non-basic at 0", () => {
    const init = initialSkills();
    expect(init["brawling"]).toBe(2);
    expect(init["gamble"]).toBe(0);
    expect(init["language"]).toEqual([{ name: "Streetslang", level: 2 }]);
    expect(init["localExpert"]).toEqual([{ name: "Tu hogar", level: 2 }]);
    expect(init["science"]).toEqual([]);
    expect(init["playInstrument"]).toEqual([]);
  });

  it("counts basic at 2 as free and +1s as 1 IP each", () => {
    const out = derivedSkills({ brawling: 4, gamble: 3 });
    expect(out.spent).toBe(2 + 3);
    expect(out.left).toBe(8 - 5);
  });

  it("charges x2 skills double per +1", () => {
    // martialArts is x2; baseline 0, so 4 levels = 4 * 2 = 8 IP
    const out = derivedSkills({ martialArts: 4 });
    expect(out.spent).toBe(8);
  });

  it("only the first instance of a basic+repeatable inherits the baseline", () => {
    // language is basic+repeatable: first at 2 free, second at 2 costs 2 IP
    const out = derivedSkills({ language: [{ name: "Streetslang", level: 2 }, { name: "Japanese", level: 2 }] });
    expect(out.spent).toBe(2);
  });

  it("ignores garbage in the input", () => {
    const out = derivedSkills({ brawling: "not a number" as unknown as number, science: "junk" as unknown as never });
    expect(out.skills["brawling"]).toBe(2);
    expect(out.skills["science"]).toEqual([]);
  });
});