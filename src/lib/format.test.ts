import { describe, expect, it } from "vitest";
import { DASH, ago, ageDays, days, gb, int, money, moneyCompact, pct, shortResource, signedPct } from "./format";

describe("formatters: missing values are never invented", () => {
  it("renders null, undefined and NaN as --", () => {
    for (const v of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(money(v as number)).toBe(DASH);
      expect(pct(v as number)).toBe(DASH);
      expect(int(v as number)).toBe(DASH);
      expect(gb(v as number)).toBe(DASH);
      expect(moneyCompact(v as number)).toBe(DASH);
    }
  });

  it("shows cents below $100 and whole dollars above", () => {
    expect(money(12.5)).toBe("$12.50");
    expect(money(4120.55)).toBe("$4,121");
    expect(money(-3.2)).toBe("-$3.20");
  });

  it("compacts large money", () => {
    expect(moneyCompact(12_400)).toBe("$12.4k");
    expect(moneyCompact(2_500_000)).toBe("$2.50M");
    expect(moneyCompact(42)).toBe("$42.00");
  });

  it("formats percentages, counts and storage", () => {
    expect(pct(159.96)).toBe("160%");
    expect(pct(12.345, 1)).toBe("12.3%");
    expect(int(1234.4)).toBe("1,234");
    expect(gb(340)).toBe("340 GB");
    expect(gb(2048)).toBe("2.0 TB");
    expect(gb(0)).toBe("0 GB");
  });

  it("pluralises days", () => {
    expect(days(0.4)).toBe("<1 day");
    expect(days(1)).toBe("1 day");
    expect(days(12.6)).toBe("13 days");
  });

  it("signs percentage changes", () => {
    expect(signedPct(54.2)).toBe("+54%");
    expect(signedPct(-8)).toBe("-8%");
    expect(signedPct(null)).toBe(DASH);
  });

  it("ago() reads relative time from epoch ms", () => {
    const now = Date.parse("2026-10-25T12:00:00Z");
    expect(ago(now - 10_000, now)).toBe("just now");
    expect(ago(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(ago(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(ago(now - 2 * 86_400_000, now)).toBe("2 d ago");
    expect(ago(null, now)).toBe(DASH);
  });

  it("ageDays() counts whole days and tolerates bad input", () => {
    const now = Date.parse("2026-10-25T12:00:00Z");
    expect(ageDays("2026-10-01T00:00:00Z", now)).toBe(24);
    expect(ageDays("not a date", now)).toBeNull();
    expect(ageDays(undefined, now)).toBeNull();
  });

  it("shortResource keeps the last path segment", () => {
    expect(shortResource("projects/p/zones/us-west1-b/instances/vm-1")).toBe("vm-1");
    expect(shortResource(null)).toBe(DASH);
  });
});
