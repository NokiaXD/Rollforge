export type DiceRoll = {
  sign: 1 | -1;
  count: number;
  sides: number;
  kept?: number;
  fudge?: true;
};

export type DiceTermResult = {
  roll: DiceRoll;
  rolls: number[];
  kept: number[];
  dropped: number[];
  subtotal: number;
};

export type DiceResult = {
  notation: string;
  terms: DiceTermResult[];
  modifier: number;
  total: number;
};

export type RollActorRef =
  | { type: "user" }
  | { type: "character"; characterId: string };

export type RollActor =
  | { type: "user"; userId: string; name: string }
  | { type: "character"; characterId: string; name: string };

// Notation parsing and budgeting live here, not on the server: the client
// previews rolls, chat autocompletes them, and Fase 2 extensions expose
// `api.dice` to third parties. Rolling itself needs an RNG and stays server-side.

export const DICE_LIMITS = {
  MAX_NOTATION_LEN: 200,
  MAX_DICE_PER_TERM: 100,
  MAX_SIDES: 1000,
  MAX_TERMS: 10,
} as const;

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

// Parsed both for validation and for matching roll output by index/order.
// Each term uses `kept = how many dice remain after kh/kl`.
export function parseDiceTerms(notation: string): DiceRoll[] {
  const out: DiceRoll[] = [];
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
    const roll: DiceRoll = { sign, count, sides };
    if (fudge) roll.fudge = true;
    if (kept !== undefined) roll.kept = kept;
    out.push(roll);
  }
  return out;
}

export function validateDice(notation: string): DiceValidation {
  const t = notation.trim();
  if (!t || t.length > DICE_LIMITS.MAX_NOTATION_LEN) return { ok: false, reason: "bad-notation" };
  // allow any character — the roller is the final gate. We only enforce OUR
  // budgeting limits and kh/kl shape.
  const terms = parseDiceTerms(t);
  if (terms.length === 0) return { ok: false, reason: "bad-notation" };
  if (terms.length > DICE_LIMITS.MAX_TERMS) return { ok: false, reason: "too-many-terms" };
  for (const term of terms) {
    if (term.count === 0) return { ok: false, reason: "invalid-keep" };
    if (term.count > DICE_LIMITS.MAX_DICE_PER_TERM) {
      return { ok: false, reason: "dice-count-too-large" };
    }
    if (!term.fudge && term.sides > DICE_LIMITS.MAX_SIDES) {
      return { ok: false, reason: "face-too-large" };
    }
    if (term.kept !== undefined && (term.kept <= 0 || term.kept > term.count)) {
      return { ok: false, reason: "invalid-keep" };
    }
  }
  return { ok: true };
}
