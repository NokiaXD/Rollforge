//  Served RAW at /api/extension-sources/ruler.js and parsed by the BROWSER as
//  plain ESM, which forces two things (compendium's main.client.js is the same):
//    - no JSX, only h() — the browser has no JSX transform;
//    - no relative imports ("./panel.js" would 404) and no bare imports at all:
//      the import map only covers @rollforge/*, and even for those it exists
//      only under the Vite dev server. So preact comes from api.ui.preact (the
//      host's own copy — importing "preact" through the import map yields a
//      SECOND preact whose hooks are never rendered by) and every Pixi class
//      from api.canvas.pixi, which also makes this file work when the BUILT
//      client is served from Express, where the import map does not exist.
//
//  The ruler state is local to this client: a server chat command cannot switch
//  the ruler on for one specific player, so there is no main.server.js at all.

//  Assigned by activate() below. They are only read while a component renders,
//  which cannot happen before the panel is registered.
let h, useEffect, useState;

const FADE_MS = 400;
const COLOR = 0xffe066;
const WIDTH = 5; // outline of the shape / the measured line
const THIN = 3; // the A-B guide drawn over the square and the circle
const ARROW = 26; // arrowhead length on the line shape
const NOSE = 12; // how far the arrowhead apex sticks out past the tip
const SHAPES = [
  ["line", "Linea"],
  ["square", "Cuadrado"],
  ["circle", "Circulo"],
];
//  Cycled by Shift+R, in this order.
const SNAPS = [
  ["center", "Centro"],
  ["corner", "Esquina"],
  ["off", "Sin ajuste"],
];

//  Extension-local options. Not persisted: the repo uses no localStorage yet.
const opts = { on: false, shape: "line", snap: "center", fade: true };

//  Panel subscribers, so the R / Shift+R keys repaint the sidebar tab.
const subs = new Set();

let api = null;
let vp = null;
let box = null; // Pixi Container
let gfx = null; // Pixi Graphics
let tag = null; // Pixi Text (the distance label)
let bound = []; // [event, handler] pairs hung on the current viewport
let anchor = null; // world point the measurement starts from
let tip = null; // world point it currently ends at
let drawing = false;
let fadeAt = 0;
let fadeRaf = 0;

//  Pure, so test/measure.test.js can check the scale maths without a browser.
//  Snapped, the cell is counted as a whole instead of as a fraction: from a
//  cell CENTRE the next cell is 1 away, from a CORNER the very next pixel
//  inside the same cell already is 1. Unsnapped keeps the exact euclidean
//  count (1.4 casillas across a diagonal), which is what you want while free
//  drawing and useless once both ends sit on grid marks.
export function measure(ax, ay, bx, by, cell, cellLength, units, snap = "off") {
  const dist = cell > 0 ? Math.hypot(bx - ax, by - ay) : 0;
  const raw = cell > 0 ? dist / cell : 0;
  const cells = snap === "center" ? Math.round(raw) : snap === "corner" ? (dist > 0 ? Math.ceil(raw - 1e-9) : 0) : raw;
  const value = cells * cellLength;
  const amount = units === "m" ? `${value.toFixed(1)} m` : `${Math.round(value)} ft`;
  const round = Math.round(cells * 10) / 10;
  const shown = Number.isInteger(round) ? String(round) : round.toFixed(1);
  return { cells, value, text: `${amount} - ${shown} ${round === 1 ? "casilla" : "casillas"}` };
}

export function snapPoint(p, cell, mode) {
  if (mode === "off" || !(cell > 0)) return p;
  const off = mode === "center" ? 0.5 : 0;
  return { x: (Math.round(p.x / cell - off) + off) * cell, y: (Math.round(p.y / cell - off) + off) * cell };
}

//  A PERFECT square born from the anchor's CENTRE, looking straight at the tip:
//  the tip is the MIDDLE of the facing side, not a vertex, so AB is that side's
//  perpendicular and the cross line through the centre ends exactly on the tip.
//  Side is 2 * radius. Null when A and B coincide (nothing to build on).
export function squarePoints(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const r = Math.hypot(dx, dy);
  if (!(r > 0)) return null;
  const ux = dx / r;
  const uy = dy / r; // from the centre towards the tip
  const vx = -uy;
  const vy = ux; // along the facing side
  return [
    { x: ax + ux * r + vx * r, y: ay + uy * r + vy * r },
    { x: ax + ux * r - vx * r, y: ay + uy * r - vy * r },
    { x: ax - ux * r - vx * r, y: ay - uy * r - vy * r },
    { x: ax - ux * r + vx * r, y: ay - uy * r + vy * r },
  ];
}

//  Roll20 measures from the token's middle, not from the pixel that was grabbed
//  — the grab point can be half a cell off and the number would be wrong. Read at
//  pointerdown, before anything has moved, so the ~50ms server lag of the token
//  signal does not matter here.
function anchorFor(p) {
  const cell = api.scene.cellSize();
  for (const t of api.scene.tokens()) {
    const hw = (t.w * cell) / 2;
    const hh = (t.h * cell) / 2;
    if (p.x >= t.x - hw && p.x <= t.x + hw && p.y >= t.y - hh && p.y <= t.y + hh) {
      return { x: t.x, y: t.y };
    }
  }
  return p;
}

function clear() {
  anchor = null;
  tip = null;
  drawing = false;
  if (box) {
    box.alpha = 1;
    draw();
  }
}

function draw() {
  gfx.clear();
  if (!anchor || !tip) {
    tag.text = "";
    return;
  }
  const m = measure(anchor.x, anchor.y, tip.x, tip.y, api.scene.cellSize(), api.scene.cellLength(), api.scene.units(), opts.snap);
  tag.text = m.text;

  if (opts.shape === "square") {
    const q = squarePoints(anchor.x, anchor.y, tip.x, tip.y);
    if (!q) return;
    gfx
      .poly(q.flatMap((p) => [p.x, p.y]))
      .fill({ color: COLOR, alpha: 0.15 })
      .stroke({ color: COLOR, width: WIDTH })
      //  A-B on top: the square is twice the measured distance wide, so without
      //  it there is nothing to see that says where the number came from.
      .moveTo(anchor.x, anchor.y)
      .lineTo(tip.x, tip.y)
      .stroke({ color: COLOR, width: THIN });
    tag.position.set(anchor.x, anchor.y);
    return;
  }
  if (opts.shape === "circle") {
    const r = Math.hypot(tip.x - anchor.x, tip.y - anchor.y);
    gfx
      .circle(anchor.x, anchor.y, r)
      .fill({ color: COLOR, alpha: 0.12 })
      .stroke({ color: COLOR, width: WIDTH })
      .moveTo(anchor.x, anchor.y)
      .lineTo(tip.x, tip.y)
      .stroke({ color: COLOR, width: THIN });
    tag.position.set(anchor.x, anchor.y - r);
    return;
  }
  gfx.moveTo(anchor.x, anchor.y).lineTo(tip.x, tip.y).stroke({ color: COLOR, width: WIDTH });
  //  Arrowhead on the tip. The apex sticks out half the shaft width PAST the
  //  tip: the line is stroked with a flat cap, so without that overhang the
  //  visible end of the drawing is the cap and the head looks like it stops
  //  short of the point. A narrow head does the same thing — the sliver near the
  //  apex is thinner than the shaft and disappears inside it.
  const ang = Math.atan2(tip.y - anchor.y, tip.x - anchor.x);
  gfx
    .poly([
      tip.x + Math.cos(ang) * NOSE,
      tip.y + Math.sin(ang) * NOSE,
      tip.x - Math.cos(ang - 0.55) * ARROW,
      tip.y - Math.sin(ang - 0.55) * ARROW,
      tip.x - Math.cos(ang + 0.55) * ARROW,
      tip.y - Math.sin(ang + 0.55) * ARROW,
    ])
    .fill({ color: COLOR });
  tag.position.set((anchor.x + tip.x) / 2, (anchor.y + tip.y) / 2);
}

function onDown(e) {
  if (!opts.on || e.button !== 0) return;
  cancelAnimationFrame(fadeRaf);
  fadeRaf = 0;
  drawing = true;
  //  Both ends snap: the anchor too, otherwise a snapped run would start half a
  //  cell off and every count would be off by that much.
  anchor = snapPoint(anchorFor(vp.toWorld(e.global)), api.scene.cellSize(), opts.snap);
  tip = anchor;
  box.alpha = 1;
  draw();
}

function onMove(e) {
  if (!drawing) return;
  const p = vp.toWorld(e.global);
  tip = snapPoint(p, api.scene.cellSize(), opts.snap);
  draw();
}

//  One handler covers both cases: pressed on a token it measures how far the
//  token travelled (TokenSprite's own handlers do the moving), pressed on empty
//  space it is a free measurement. Nothing needs to know which it was.
function onUp() {
  if (!drawing) return;
  drawing = false;
  if (!opts.fade) return;
  fadeAt = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - fadeAt) / FADE_MS);
    box.alpha = 1 - k;
    draw();
    fadeRaf = k < 1 ? requestAnimationFrame(step) : 0;
    if (k >= 1) clear();
  };
  fadeRaf = requestAnimationFrame(step);
}

function isTyping(e) {
  const t = e.target;
  return (
    !!t &&
    (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable === true)
  );
}

function emit() {
  for (const fn of [...subs]) fn();
}

//  Both halves of an option change, or it looks broken: emit() repaints the
//  panel buttons and draw() repaints the line already on the canvas, which would
//  otherwise keep the old count until the next pointermove.
function setSnap(id) {
  opts.snap = id;
  emit();
  if (box) draw();
}

function onKey(e) {
  //  The host's own key handler (ui/App.tsx) does not filter inputs, so a bare
  //  letter would fire while typing in chat or in any sheet field.
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTyping(e)) return;
  if (e.key === "Escape") {
    clear();
    return;
  }
  if (e.key !== "r" && e.key !== "R") return;
  e.preventDefault();
  if (e.shiftKey) setSnap(SNAPS[(SNAPS.findIndex(([id]) => id === opts.snap) + 1) % SNAPS.length][0]);
  else {
    opts.on = !opts.on;
    if (!opts.on) clear();
  }
  emit();
}

//  onReady fires for EVERY viewport, not once: ui/App.tsx is HMR'd in dev and that
//  recreates Pixi from scratch. Detach from the old one before adopting the new
//  one, or these listeners stay hung on a destroyed viewport forever.
function attach(next) {
  if (vp) for (const [ev, fn] of bound) vp.off(ev, fn);
  if (vp && box) vp.removeChild(box);
  if (box) box.destroy({ children: true });

  vp = next;
  //  The grid (canvas/grid.ts) and the token sprites are plain siblings of this
  //  box at zIndex 0, and the grid is re-added on the TOP of the viewport every
  //  time it redraws — without this the lines vanish under the malla. Everything
  //  else keeps its insertion order, so nothing else moves.
  vp.sortableChildren = true;
  box = new api.canvas.pixi.Container();
  box.zIndex = 1000;
  gfx = new api.canvas.pixi.Graphics();
  tag = new api.canvas.pixi.Text({
    text: "",
    style: {
      fill: 0xffffff,
      fontSize: 15,
      fontFamily: "system-ui",
      stroke: { color: 0x000000, width: 4, join: "round" },
    },
  });
  tag.anchor.set(0.5);
  box.addChild(gfx, tag);
  vp.addChild(box);

  bound = [
    ["pointerdown", onDown],
    ["pointermove", onMove],
    ["pointerup", onUp],
    ["pointerupoutside", onUp],
  ];
  for (const [ev, fn] of bound) vp.on(ev, fn);
  clear();
}

function Toggle({ label, hint, on, onChange }) {
  return h(
    "button",
    {
      type: "button",
      onClick: onChange,
      class:
        "flex w-full items-center justify-between gap-2 rounded border border-white/5 bg-black/30 px-2 py-1.5 text-left transition-colors hover:border-white/15",
    },
    h("span", { class: on ? "text-white" : "text-muted" }, label),
    h(
      "span",
      { class: "flex items-center gap-1.5" },
      hint ? h("kbd", { class: "rounded border border-white/20 bg-white/5 px-1 font-mono text-[10px] text-muted" }, hint) : null,
      h("span", { class: `h-3 w-3 rounded-full border border-white/20 ${on ? "bg-accent" : "bg-white/10"}` }),
    ),
  );
}

//  Same markup for "Forma" and for the grid fit, so both are one call.
function Choice({ label, hint, options, value, onChange }) {
  return h(
    "div",
    { class: "space-y-1.5" },
    h(
      "span",
      { class: "flex items-center gap-1.5 text-muted" },
      label,
      hint ? h("kbd", { class: "rounded border border-white/20 bg-white/5 px-1 font-mono text-[10px] text-muted" }, hint) : null,
    ),
    h(
      "div",
      { class: "flex gap-1" },
      options.map(([id, text]) =>
        h(
          "button",
          {
            key: id,
            type: "button",
            onClick: () => onChange(id),
            class: `flex-1 rounded px-1.5 py-1 text-[11px] transition-colors ${
              value === id ? "bg-accent text-white" : "bg-white/5 text-muted hover:text-white"
            }`,
          },
          text,
        ),
      ),
    ),
  );
}

function Panel() {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  }, []);

  return h(
    "div",
    { class: "space-y-3 p-3 text-xs" },
    h(Toggle, {
      label: "Regla activa",
      hint: "R",
      on: opts.on,
      onChange: () => {
        opts.on = !opts.on;
        if (!opts.on) clear();
      },
    }),
    h(Choice, {
      label: "Forma",
      options: SHAPES,
      value: opts.shape,
      onChange: (id) => {
        opts.shape = id;
        emit();
      },
    }),
    h(Choice, {
      label: "Ajuste a la cuadrícula",
      hint: "Shift + R",
      options: SNAPS,
      value: opts.snap,
      onChange: (id) => {
        setSnap(id);
      },
    }),
    h(Toggle, {
      label: "Desvanecer al soltar",
      on: opts.fade,
      onChange: () => {
        opts.fade = !opts.fade;
      },
    }),
    h(
      "p",
      { class: "rounded border border-white/5 bg-black/30 p-2 text-[11px] text-muted" },
      "Esta escena: ",
      h("strong", { class: "text-white" }, `1 casilla = ${api.scene.cellLength()} ${api.scene.units() === "m" ? "m" : "ft"}`),
      h("br"),
      "Se cambia en el formulario de edición de la escena.",
    ),
    h("p", { class: "text-[10px] text-muted" }, "Esc borra la línea."),
  );
}

export default function activate(host) {
  api = host;
  ({ h, useEffect, useState } = api.ui.preact);
  api.canvas.onReady(attach);
  window.addEventListener("keydown", onKey);
  host.ui.registerPanel({ id: "ruler", title: "Regla", icon: "nf-fa-ruler_vertical", component: Panel });
}
