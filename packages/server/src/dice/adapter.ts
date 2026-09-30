import { DiceRoll, NumberGenerator } from "@dice-roller/rpg-dice-roller";
import { randomInt } from "node:crypto";
import {
  parseDiceTerms,
  validateDice,
  type DiceResult,
  type DiceTermResult,
} from "@rollforge/protocol";

export const HISTORY_PAGE = 50;
export const MAX_LEN_MESSAGE = 2000;

// the library's export() type expects an enum-like object but its runtime
// only cares about the numeric value. We just need OBJECT (2). Cast through unknown to
// satisfy strict typing without re-importing the enum shape.
const EXPORT_OBJECT = 2 as unknown as Parameters<DiceRoll["export"]>[0];

// parseDiceTerms / validateDice live in @rollforge/protocol: the client parses
// too. Only the actual roll needs the library and the crypto RNG.

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
