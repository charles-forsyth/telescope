import { describe, expect, it } from "vitest";
import { CONFIRM_MIN_MS, CONFIRM_TTL_MS, FOCUS_GRACE_MS, IntentGate } from "./signin-gate";

const T0 = 1_000_000;

describe("sign-in intent gate", () => {
  it("ignores a click that lands right after the window appears", () => {
    const g = new IntentGate(T0);
    expect(g.first(T0 + 200, true, 1)).toBe(false);
    expect(g.step).toBe("idle");
  });

  it("ignores untrusted or keyboard activation (detail 0)", () => {
    const g = new IntentGate(T0);
    expect(g.first(T0 + FOCUS_GRACE_MS + 10, false, 1)).toBe(false);
    expect(g.first(T0 + FOCUS_GRACE_MS + 10, true, 0)).toBe(false);
  });

  it("needs two deliberate clicks, the second not a double-click", () => {
    const g = new IntentGate(T0);
    const t = T0 + FOCUS_GRACE_MS + 10;
    expect(g.first(t, true, 1)).toBe(true);
    expect(g.step).toBe("confirm");
    expect(g.confirm(t + 50, true, 2)).toBe(false); // double-click is refused
    expect(g.step).toBe("idle");
    expect(g.first(t + 600, true, 1)).toBe(true);
    expect(g.confirm(t + 600 + CONFIRM_MIN_MS + 1, true, 1)).toBe(true);
    expect(g.confirm(t + 600 + CONFIRM_MIN_MS + 2, true, 1)).toBe(false); // single use
  });

  it("confirm alone never starts sign-in", () => {
    const g = new IntentGate(T0);
    expect(g.confirm(T0 + 10_000, true, 1)).toBe(false);
  });

  it("refocusing the window resets the gate", () => {
    const g = new IntentGate(T0);
    const t = T0 + FOCUS_GRACE_MS + 10;
    expect(g.first(t, true, 1)).toBe(true);
    g.noteActivation(t + 500);
    expect(g.step).toBe("idle");
    expect(g.confirm(t + 1000, true, 1)).toBe(false);
  });

  it("a stale confirm panel expires", () => {
    const g = new IntentGate(T0);
    const t = T0 + FOCUS_GRACE_MS + 10;
    g.first(t, true, 1);
    expect(g.confirm(t + CONFIRM_TTL_MS + 1, true, 1)).toBe(false);
  });
});
