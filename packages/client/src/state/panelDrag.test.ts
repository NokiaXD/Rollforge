import { describe, expect, it } from "vitest";
import { zoneForX } from "./panelDrag";

const strips = { left: 368, right: 320 }; // 48 activity bar + 320 sidebar

describe("zoneForX", () => {
  it("maps the left strip to the left dock", () => {
    expect(zoneForX(0, strips, 1200)).toBe("left");
    expect(zoneForX(367, strips, 1200)).toBe("left");
  });

  it("maps the right strip to the right dock", () => {
    expect(zoneForX(881, strips, 1200)).toBe("right");
    expect(zoneForX(1199, strips, 1200)).toBe("right");
  });

  it("maps everything in between to the center (pop-out)", () => {
    expect(zoneForX(368, strips, 1200)).toBe("center");
    expect(zoneForX(880, strips, 1200)).toBe("center");
  });
});