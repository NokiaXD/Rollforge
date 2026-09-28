import { DiceRoll, NumberGenerator } from "@dice-roller/rpg-dice-roller";
import { randomInt } from "node:crypto";
import type { DiceResult, DiceRoll as OurDiceRoll, DiceTermResult } from "@rollforge/protocol";

// the library's export() type expects an enum-like object but its runtime
// only cares about the numeric value. We just need OBJECT (2). Cast through unknown to
// satisfy strict typing without re-importing the enum shape.
const EXPORT_OBJECT = 2 as unknown as Parameters<DiceRoll["export"]>[0];

export const LIMITS = {
  MAX_NOTATION_LEN: 200,
  MAX_DICE_PER_TERM: 100,
  MAX_SIDES: 1000,
  MAX_TERMS: 10,
} as const;

export const HISTORY_PAGE = 50;
export const MAX_LEN_MESSAGE = 2000;

export type DiceValidation =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "bad-notation"
        | "too-many-terms"
        | "dice-count-too-large"
        | "face-too-large"
        | "invalid-keep";
    };

const TERM_RE = /([+-]?)(\d*)d(F|\d+)/gi;
const KEEP_RE = /^k(h|l)?(\d+)?/i;

// parsed both for validation and for matching library output by index/order.
// Each term returned here uses `kept = how many dice remain after kh/kl`.
export function parseDiceTerms(notation: string): OurDiceRoll[] {
  const out: OurDiceRoll[] = [];
  for (const m of notation.matchAll(TERM_RE)) {
    const sign = m[1] === "-" ? -1 : 1;
    const count = m[2] === "" ? 1 : Number(m[2]);
    const sidesRaw = m[3] ?? "";
    const fudge = sidesRaw.toUpperCase() === "F";
    const sides = fudge ? 0 : Number(sidesRaw);
    const rest = notation.slice(Number(m.index) + m[0].length);
    const km = KEEP_RE.exec(rest);
    let kept: number | undefined;
    if (km && (km[1] !== undefined || km[2] !== undefined)) {
      const klDrop = (km[1] ?? "").toLowerCase() === "l";
      const keepN = km[2] !== undefined ? Number(km[2]) : 1;
      // kh0 / kl0 are nonsensical (drop 0 / keep 0). Mark as invalid-keep.
      if (keepN <= 0) {
        kept = 0;
      } else {
        kept = klDrop ? count - keepN : keepN;
      }
    }
    const roll: OurDiceRoll = { sign, count, sides };
    if (fudge) roll.fudge = true;
    if (kept !== undefined) roll.kept = kept;
    out.push(roll);
  }
  return out;
}

export function validateDice(notation: string): DiceValidation {
  const t = notation.trim();
  if (!t || t.length > LIMITS.MAX_NOTATION_LEN) return { ok: false, reason: "bad-notation" };
  // allow any character — the library's own parser is the final gate.
  // We only need to enforce OUR budgeting limits and kh/kl shape.
  const terms = parseDiceTerms(t);
  if (terms.length === 0) return { ok: false, reason: "bad-notation" };
  if (terms.length > LIMITS.MAX_TERMS) return { ok: false, reason: "too-many-terms" };
  for (const term of terms) {
    if (term.count === 0) return { ok: false, reason: "invalid-keep" };
    if (term.count > LIMITS.MAX_DICE_PER_TERM) {
      return { ok: false, reason: "dice-count-too-large" };
    }
    if (!term.fudge && term.sides > LIMITS.MAX_SIDES) {
      return { ok: false, reason: "face-too-large" };
    }
    if (term.kept !== undefined && (term.kept <= 0 || term.kept > term.count)) {
      return { ok: false, reason: "invalid-keep" };
    }
  }
  return { ok: true };
}

// the library guards its own inner loops against runaway counts and faces,
// but historically took untrusted input from the network. We pre-validate both because
// the parser uses recursion on each term — large values can stall the event loop.
export function rollDice(notation: string): DiceResult {
  const v = validateDice(notation);
  if (!v.ok) throw new Error(`dice:${v.reason}`);
  const parsed = new DiceRoll(notation);
  const exported = parsed.export(EXPORT_OBJECT);
  // the .d.ts type wrongly declares export(OBJECT) as `string | null`,
  // but the runtime returns the parsed object directly. Branch accordingly.
  let data: RollExport;
  if (typeof exported === "string") {
    data = JSON.parse(exported) as RollExport;
  } else if (exported && typeof exported === "object") {
    data = exported as RollExport;
  } else {
    throw new Error("dice:export-empty");
  }
  return convertToDiceResult(notation, data);
}

// Fudge mapping (rng(3) - 2) is applied here, not on the server. Server still uses
// crypto.randomInt(1, sides+1); Fudge dice roll 0..2 from the library's side, mapped to -1/0/+1
// inside the library, so the engine wrapper stays generic.
export const cryptoRng = {
  next(): number {
    return randomInt(0, 0x1_0000_0000);
  },
};

export function installCryptoEngine(): void {
  NumberGenerator.generator.engine = cryptoRng;
}

// withTestEngine swaps the engine for the duration of `fn`. Used by tests to
// reproduce specific rolls deterministically ([12, 7] -> total 17 for 2d20kh1+5).
export function withTestEngine<T>(engine: { next(): number }, fn: () => T): T {
  const prev = NumberGenerator.generator.engine;
  NumberGenerator.generator.engine = engine;
  try {
    return fn();
  } finally {
    NumberGenerator.generator.engine = prev;
  }
}

interface RollResultJson {
  initialValue: number;
  value: number;
  useInTotal: boolean;
  modifiers?: string[];
}

interface DiceGroupJson {
  type: "roll-results";
  rolls: RollResultJson[];
  value: number;
}

interface RollExport {
  notation: string;
  total: number;
  rolls: Array<DiceGroupJson | string | number>;
}

function isDiceGroup(node: unknown): node is DiceGroupJson {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as { type?: unknown }).type === "roll-results" &&
    Array.isArray((node as { rolls?: unknown }).rolls)
  );
}

function convertToDiceResult(notation: string, data: RollExport): DiceResult {
  const ourTerms = parseDiceTerms(notation);
  const diceGroups = data.rolls.filter(isDiceGroup);
  // The library preserves order between dice terms and our parser. Walk them in lock-step.
  const termResults: DiceTermResult[] = [];
  for (let i = 0; i < ourTerms.length && i < diceGroups.length; i++) {
    const t = ourTerms[i];
    const g = diceGroups[i];
    if (t === undefined || g === undefined) break;
    const rolls = g.rolls.map((r) => r.initialValue);
    // useInTotal tells us what survives kh/kl. For Fudge dice the library rolls
    // -1/0/+1 directly; for plain dice the value and initialValue match unless a re-roll kept
    // the lowest (we ignore those advanced modifiers per the plan).
    const kept = g.rolls.filter((r) => r.useInTotal).map((r) => r.initialValue);
    const keptSet = new Set(kept);
    const dropped = rolls.filter((v) => !keptSet.has(v));
    const subtotal = t.sign * kept.reduce((a, b) => a + b, 0);
    termResults.push({ roll: t, rolls, kept, dropped, subtotal });
  }
  // total comes from the library — `modifier` is whatever isn't accounted for by
  // term subtotals. This matches "1d20+1d6-3" without re-parsing operators ourselves.
  const termsSum = termResults.reduce((a, b) => a + b.subtotal, 0);
  const modifier = data.total - termsSum;
  return { notation, terms: termResults, modifier, total: data.total };
}
