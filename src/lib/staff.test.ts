import { describe, expect, it } from "vitest";
import { isStaffOnly, staffNotice } from "./staff";

describe("staff gating", () => {
  it("marks the four staff-only tools", () => {
    expect(isStaffOnly("skywalker_fleet")).toBe(true);
    expect(isStaffOnly("skywalker_spend_all")).toBe(true);
    expect(isStaffOnly("skywalker_budgets")).toBe(true);
    expect(isStaffOnly("skywalker_spend_trend")).toBe(true);
    expect(isStaffOnly("skywalker_spend")).toBe(false);
  });

  it("says staff only instead of an error for a non-staff user", () => {
    const e = { kind: "tool", message: "forbidden" };
    expect(staffNotice("skywalker_fleet", e, false)).toContain("Staff only");
  });

  it("does not hide errors on ordinary tools", () => {
    expect(staffNotice("skywalker_spend", { kind: "permission", message: "x" }, false)).toBeNull();
  });
});
