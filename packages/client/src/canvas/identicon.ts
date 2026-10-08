import { minidenticon } from "minidenticons";

export interface IdenticonCells {
  /** HSL hue in degrees, as minidenticons computed it (9 distinct values). */
  hue: number;
  /** 0..4 grid coordinates of the filled cells. */
  cells: ReadonlyArray<readonly [number, number]>;
}

const HUE_RE = /fill="hsl\((\d+(?:\.\d+)?)/;
const RECT_RE = /<rect x="(-?\d+(?:\.\d+)?)" y="(-?\d+(?:\.\d+)?)"/g;

// Cache by seed: minidenticons is a pure seed -> SVG function, so the result never
// changes for a token. Populating it once per token beats re-parsing on every redraw
// (draw() runs on every lock/focus change).
const cache = new Map<string, IdenticonCells>();

/**
 * Seed for a token's identicon.
 *
 * ponytail: `token.id` is the only stable identity a token has today — there is no
 * Token -> Actor link yet, so two tokens of "the same" monster cannot share an
 * identicon. When `actorId` arrives, the seed becomes `actorId ?? token.id` so all
 * tokens of one Actor match, exactly as they would share a real image. Keeping this
 * as one function is what makes that a one-line change instead of a hunt.
 */
export function tokenSeed(tokenId: string): string {
  return tokenId;
}

/**
 * Parses minidenticons' SVG into plain cells so the canvas can draw them with
 * Graphics (sync, no texture load). The library only exports the SVG string, so this
 * reads its output rather than reimplementing its hash — the algorithm stays theirs.
 */
export function identiconCells(seed: string): IdenticonCells {
  const hit = cache.get(seed);
  if (hit) return hit;

  const svg = minidenticon(seed);
  const hue = Number(HUE_RE.exec(svg)?.[1] ?? 0);
  const cells: Array<readonly [number, number]> = [];
  for (const m of svg.matchAll(RECT_RE)) {
    // x is already 0..4: minidenticons mirrors the right half itself (7 - col for
    // i > 14), so columns 3 and 4 arrive swapped. Do NOT un-mirror or the pattern
    // comes out reflected.
    cells.push([Number(m[1]), Number(m[2])]);
  }

  const result: IdenticonCells = { hue, cells };
  cache.set(seed, result);
  return result;
}