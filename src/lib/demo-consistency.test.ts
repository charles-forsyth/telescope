import { describe, expect, it } from "vitest";
import { demoCall } from "./demo";

// Review item 3: in DEMO, the day rows of a month must add up to that month's usage exactly,
// so the "all types" credit figures on the Billing page agree.
describe("DEMO day totals match the month", () => {
  for (const month of ["2026-10", "2026-09"]) {
    it(`days of ${month} sum to the month's usage credits and gross`, async () => {
      const day = (await demoCall("skywalker_spend_all", { group_by: "day", month, limit: 60 })).data as { items: { gross: number; credits: number; net: number }[] };
      const mon = (await demoCall("skywalker_spend_all", { group_by: "project", month, limit: 500 })).data as { items: { project?: string; gross: number; credits: number }[] };
      const usage = mon.items.filter((i) => i.project !== "(none)");
      const usageGross = Math.round(usage.reduce((s, i) => s + i.gross, 0) * 100) / 100;
      const usageCredits = Math.round(usage.reduce((s, i) => s + i.credits, 0) * 100) / 100;
      const dayGross = Math.round(day.items.reduce((s, x) => s + x.gross, 0) * 100) / 100;
      const dayCredits = Math.round(day.items.reduce((s, x) => s + x.credits, 0) * 100) / 100;
      expect(Math.abs(dayGross - usageGross)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(dayCredits - usageCredits)).toBeLessThanOrEqual(0.01);
    });
  }
});
