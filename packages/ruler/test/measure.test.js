import { describe, it, expect } from "vitest";
import { measure, snapPoint, squarePoints } from "../src/main.client.js";

const side = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const dot = (a, b) => a.x * b.x + a.y * b.y;

describe("measure", () => {
  it("reads the scene scale: 1 cell of 50px = 5 ft", () => {
    //  two cells straight across
    const m = measure(0, 0, 100, 0, 50, 5, "ft");
    expect(m.cells).toBe(2);
    expect(m.value).toBe(10);
    expect(m.text).toBe("10 ft - 2 casillas");
  });

  it("measures the diagonal in euclidean cells, like Roll20", () => {
    //  one cell right + one cell down = sqrt(2) cells
    const m = measure(0, 0, 50, 50, 50, 5, "ft");
    expect(m.cells).toBeCloseTo(Math.SQRT2, 6);
    expect(m.value).toBeCloseTo(5 * Math.SQRT2, 6);
    expect(m.text).toBe("7 ft - 1.4 casillas");
  });

  it("uses metres with one decimal and the scene's cell length", () => {
    const m = measure(0, 0, 50, 0, 50, 1.5, "m");
    expect(m.cells).toBe(1);
    expect(m.value).toBe(1.5);
    expect(m.text).toBe("1.5 m - 1 casilla");
  });

  it("does not leak float noise into the square count", () => {
    //  3 * 50 = 150 exactly, but hypot(90, 120) is 150 within rounding
    const m = measure(0, 0, 90, 120, 50, 5, "ft");
    expect(m.text).toBe("15 ft - 3 casillas");
  });

  it("survives a zero cell size instead of dividing by zero", () => {
    const m = measure(0, 0, 50, 50, 0, 5, "ft");
    expect(m.cells).toBe(0);
    expect(m.text).toBe("0 ft - 0 casillas");
  });
});

describe("snapPoint", () => {
  it("centres land on the middle of a cell, corners on its vertex", () => {
    expect(snapPoint({ x: 30, y: 10 }, 50, "center")).toEqual({ x: 25, y: 25 });
    expect(snapPoint({ x: 30, y: 10 }, 50, "corner")).toEqual({ x: 50, y: 0 });
  });

  it("sin ajuste is the point itself", () => {
    expect(snapPoint({ x: 30, y: 10 }, 50, "off")).toEqual({ x: 30, y: 10 });
  });

  it("does not drift on negative world coordinates", () => {
    expect(snapPoint({ x: -30, y: -70 }, 50, "center")).toEqual({ x: -25, y: -75 });
  });
});

describe("measure with a grid fit", () => {
  //  50px cells: a centre sits at 25, a vertex at 0.
  it("centro: 0 on the cell it starts in, 1 on the next centre", () => {
    expect(measure(25, 25, 25, 25, 50, 5, "ft", "center").text).toBe("0 ft - 0 casillas");
    expect(measure(25, 25, 75, 25, 50, 5, "ft", "center").text).toBe("5 ft - 1 casilla");
    expect(measure(25, 25, 125, 25, 50, 5, "ft", "center").text).toBe("10 ft - 2 casillas");
  });

  it("esquina: the next pixel inside the same cell already counts as 1", () => {
    expect(measure(0, 0, 0, 0, 50, 5, "ft", "corner").text).toBe("0 ft - 0 casillas");
    expect(measure(0, 0, 1, 0, 50, 5, "ft", "corner").text).toBe("5 ft - 1 casilla");
    expect(measure(0, 0, 50, 0, 50, 5, "ft", "corner").text).toBe("5 ft - 1 casilla");
    expect(measure(0, 0, 50, 50, 50, 5, "ft", "corner").text).toBe("10 ft - 2 casillas");
  });

  it("sin ajuste keeps the fraction, snapped counts whole cells", () => {
    const free = measure(0, 0, 50, 50, 50, 5, "ft", "off");
    expect(free.cells).toBeCloseTo(Math.SQRT2, 6);
    expect(measure(0, 0, 50, 50, 50, 5, "ft", "corner").cells).toBe(2);
  });
});

describe("squarePoints", () => {
  //  Born from the anchor's centre and looking at the tip: the tip is the MIDDLE
  //  of the facing side, so AB is the perpendicular to it and the cross line
  //  through the centre ends on the tip.
  it("is a perfect square: every side is 2 * the measured radius", () => {
    const q = squarePoints(0, 0, 40, 10);
    const r = Math.hypot(40, 10);
    for (let i = 0; i < 4; i++) expect(side(q[i], q[(i + 1) % 4])).toBeCloseTo(2 * r, 9);
  });

  it("is centred on the anchor", () => {
    const q = squarePoints(10, 20, 50, 60);
    const cx = q.reduce((s, p) => s + p.x, 0) / 4;
    const cy = q.reduce((s, p) => s + p.y, 0) / 4;
    expect(cx).toBeCloseTo(10, 9);
    expect(cy).toBeCloseTo(20, 9);
  });

  it("ends on the middle of the facing side, not on a vertex", () => {
    const q = squarePoints(0, 0, 40, 10);
    const mid = { x: (q[0].x + q[1].x) / 2, y: (q[0].y + q[1].y) / 2 };
    expect(mid.x).toBeCloseTo(40, 9);
    expect(mid.y).toBeCloseTo(10, 9);
  });

  it("has AB perpendicular to that side", () => {
    const q = squarePoints(0, 0, 40, 10);
    const ab = { x: 40, y: 10 };
    const facing = { x: q[1].x - q[0].x, y: q[1].y - q[0].y };
    expect(dot(ab, facing)).toBeCloseTo(0, 9);
  });

  it("is null when both ends are the same point", () => {
    expect(squarePoints(20, 20, 20, 20)).toBeNull();
  });
});
