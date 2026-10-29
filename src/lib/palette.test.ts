import { describe, expect, it } from "vitest";
import { heatColor, C, SERIES } from "./palette";

describe("item 10: project identity colours avoid status red and green", () => {
  it("no series colour is a pure red or green family hue", () => {
    const hue = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max === min) return null;
      const d = max - min;
      let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    for (const c of SERIES) {
      const h = hue(c);
      if (h === null) continue;
      // red ~0-20 and 340-360, green ~90-150 (the status family).
      const isRed = h <= 20 || h >= 340;
      const isGreen = h >= 90 && h <= 150;
      expect(isRed || isGreen, c).toBe(false);
    }
  });
});

describe("heatColor", () => {
  it("is muted when there is no number", () => {
    expect(heatColor(null)).toBe(C.muted);
    expect(heatColor(Number.NaN)).toBe(C.muted);
  });
  it("steps from good to alert", () => {
    expect(heatColor(10)).toBe(C.good);
    expect(heatColor(80)).toBe(C.warn);
    expect(heatColor(95)).toBe(C.hot);
    expect(heatColor(120)).toBe(C.alert);
  });
});
