import { describe, expect, it } from "vitest";
import { isAccountLevel, monthRow, paceVsLast, pacificMonth, projectRows, recentMonths, topShare, usageBar, type SpendAll } from "./pssa";
import { netLine } from "./format";

describe("review item 4: credits above usage (negative net)", () => {
  it("gross 100, credits -120 gives net -20", () => {
    // Fully covered: the whole gross bar is credits consumed, the net segment is 0 (never amber "Usage net").
    expect(usageBar(100, -120).net).toBe(0);
    expect(usageBar(100, -120).over).toBe(true);
    expect(usageBar(100, -120).consumed).toBe(100);
  });

  it("the on-screen arithmetic still adds up when credits exceed usage", () => {
    expect(netLine(100, -120)).toBe("$100 gross, -$120 credits = -$20 net");
  });

  it("a normal bar stacks as net + |credits| = gross", () => {
    const b = usageBar(100, -30);
    expect(b).toEqual({ net: 70, consumed: 30, over: false });
    expect((b.net as number) + (b.consumed as number)).toBe(100);
  });

  it("a missing figure draws nothing rather than zero", () => {
    expect(usageBar(null, -30)).toEqual({ net: null, consumed: null, over: false });
  });
});

// Shaped like billing.spend(group_by="project") for one month.
// Fee 142,000 (account-level, "(none)"), usage gross 210,000, credits -198,000 (all types).
const OCT: SpendAll = {
  window: { label: "2026-10" },
  total: { gross: 352_000, credits: -198_000, net: 154_000 },
  items: [
    { project: "(none)", gross: 142_000, credits: 0, net: 142_000 },
    { project: "demo-lab-aurora", gross: 120_000, credits: -110_000, net: 10_000 },
    { project: "demo-lab-cirrus", gross: 60_000, credits: -50_000, net: 10_000 },
    { project: "demo-lab-basalt", gross: 30_000, credits: -38_000, net: -8_000 },
  ],
  truncated: false,
};

describe("monthRow: account-level fee, usage and credits", () => {
  it("takes the (none) row as the fee and derives usage gross from the total", () => {
    const m = monthRow("2026-10", OCT);
    expect(m.fee).toBe(142_000);
    expect(m.usageGross).toBe(210_000);
    expect(m.credits).toBe(-198_000);
    expect(m.net).toBe(154_000);
  });

  it("benefit/fee ratio uses ALL credits over the fee, as a positive multiple", () => {
    expect(monthRow("2026-10", OCT).ratio).toBeCloseTo(198_000 / 142_000);
  });

  it("is null everywhere when the answer is missing or truncated", () => {
    expect(monthRow("2026-09", null).fee).toBeNull();
    expect(monthRow("2026-09", { ...OCT, truncated: true }).credits).toBeNull();
    expect(monthRow("2026-09", { ...OCT, truncated: true }).ratio).toBeNull();
  });

  it("ratio is null when there is no fee", () => {
    const noFee: SpendAll = { ...OCT, items: OCT.items.filter((i) => i.project !== "(none)") };
    expect(monthRow("2026-10", noFee).ratio).toBeNull();
  });
});

describe("projectRows: per project, account-level excluded", () => {
  it("drops the (none) row and sorts by credits consumed (most first)", () => {
    const rows = projectRows(OCT);
    expect(rows.map((r) => r.project)).toEqual(["demo-lab-aurora", "demo-lab-cirrus", "demo-lab-basalt"]);
    expect(rows.some((r) => r.project === "(none)")).toBe(false);
  });

  it("treats a missing project as account-level", () => {
    expect(isAccountLevel(undefined)).toBe(true);
    expect(isAccountLevel("(none)")).toBe(true);
    expect(isAccountLevel("demo-x")).toBe(false);
  });

  it("topShare reports how many projects reach 80% of credits", () => {
    // credits: -110k, -38k, -50k => total -198k; top one = 55.6%, top two = 74.7%, top three = 100%.
    const t = topShare(projectRows(OCT), 3);
    expect(t?.count).toBe(3);
    expect(t?.share).toBeCloseTo(100);
  });
});

describe("pace and months", () => {
  it("paceVsLast compares this month so far with last month on the same day", () => {
    expect(paceVsLast(-73_000, -146_000)).toBeCloseTo(-50);
    expect(paceVsLast(null, -1)).toBeNull();
    expect(paceVsLast(-5, 0)).toBeNull();
  });

  it("uses Pacific time for the billing month, so UTC rollover does not move it", () => {
    // 2026-11-01 03:00 UTC is still 31 Oct in Los Angeles.
    expect(pacificMonth(new Date("2026-11-01T03:00:00Z"))).toBe("2026-10");
    expect(pacificMonth(new Date("2026-11-01T09:00:00Z"))).toBe("2026-11");
  });

  it("recentMonths returns the last N months oldest first", () => {
    expect(recentMonths(new Date("2026-10-25T16:00:00Z"), 3)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });
});

import { pssaInsights, shortId } from "./pssa";

describe("review item 15: billing insights come only from the figures", () => {
  const cur = { month: "2026-10", fee: 142_000, usageGross: 11_000, credits: -73_000, net: 80_000, usageNet: 1_134, usageCredits: -73_000, feeCredits: 0, ratio: 73_000 / 142_000 };

  it("states fee minus credits as unused subscription value, all types", () => {
    const s = pssaInsights(cur, [], 10, 31);
    expect(s[0]).toBe("Fee minus credits so far = $69,000 of subscription value not yet used (all credit types)");
  });

  it("projects the month close from the daily rate, labelled as a projection", () => {
    const s = pssaInsights(cur, [], 10, 31);
    const proj = s.find((x) => x.includes("closes near"));
    expect(proj).toContain("(projection, all credit types)");
    // 73,000 / 10 days * 31 = 226,300, which is 159% of the 142,000 fee.
    expect(proj).toContain("159%");
  });

  it("states the top-3 share and usage as a share of the fee", () => {
    const rows = [
      { project: "a", gross: 10, credits: -50, net: 0 },
      { project: "b", gross: 10, credits: -30, net: 0 },
      { project: "c", gross: 10, credits: -10, net: 0 },
      { project: "d", gross: 10, credits: -10, net: 0 },
    ];
    const s = pssaInsights(cur, rows, 10, 31);
    expect(s.some((x) => x === "Top 3 projects hold 90% of credits (all credit types)")).toBe(true);
    expect(s.some((x) => x === "Usage gross is 8% of the fee")).toBe(true);
  });

  it("says nothing when the fee or credits are missing", () => {
    expect(pssaInsights({ ...cur, fee: null }, [], 10, 31)).toEqual([]);
    expect(pssaInsights({ ...cur, credits: null }, [], 10, 31)).toEqual([]);
    expect(pssaInsights(null, [], 10, 31)).toEqual([]);
  });
});

describe("shortId drops the shared prefix", () => {
  it("keeps the whole id when there is no prefix", () => {
    expect(shortId("demo-lab-aurora", "")).toBe("demo-lab-aurora");
    expect(shortId("demo-lab-aurora", "demo-lab-")).toBe("aurora");
  });
});

import { projectBars } from "./pssa";

describe("review item 3: per-project bars never draw below zero", () => {
  it("gross 100 / credits -120: both series are >= 0 and the bar is one gross bar", () => {
    const [b] = projectBars([{ project: "p", gross: 100, credits: -120, net: -20 }]);
    expect(b.net).toBeGreaterThanOrEqual(0);
    expect(b.consumed).toBeGreaterThanOrEqual(0);
    expect(b.net).toBe(0);
    expect(b.consumed).toBe(100);
    expect(b.below).toBe(-20); // the shortfall, drawn left of zero and named in the legend
    expect(b.over).toBe(true);
  });

  it("for every row, net + consumed === gross when credits do not exceed usage, and both are >= 0 always", () => {
    const rows = [
      { project: "a", gross: 100, credits: -120, net: -20 },
      { project: "b", gross: 100, credits: -30, net: 70 },
      { project: "c", gross: 0, credits: 0, net: 0 },
      { project: "d", gross: 50, credits: -50, net: 0 },
    ];
    for (const [i, b] of projectBars(rows).entries()) {
      expect(b.net as number, rows[i].project).toBeGreaterThanOrEqual(0);
      expect(b.consumed as number, rows[i].project).toBeGreaterThanOrEqual(0);
      expect((b.net as number) + (b.consumed as number), rows[i].project).toBe(rows[i].gross);
    }
  });

  it("keeps input order and returns null for missing figures", () => {
    const out = projectBars([
      { project: "x", gross: 10, credits: -5, net: 5 },
      { project: "y", gross: Number.NaN, credits: -5, net: 0 },
    ]);
    expect(out.map((b) => b.project)).toEqual(["x", "y"]);
    expect(out[1].net).toBeNull();
  });
});
