import { describe, expect, it } from "vitest";
import { budgetSentence, heat, monthProgress, project, projectInsights, computeSentence, fleetSummary } from "./insights";

// 16 Oct 2026, 12:00 UTC: day 16 of a 31-day month.
const NOW = new Date(Date.UTC(2026, 9, 16, 12));

describe("monthProgress", () => {
  it("counts the day and days in the month", () => {
    const m = monthProgress(NOW);
    expect(m.day).toBe(16);
    expect(m.daysInMonth).toBe(31);
    expect(m.fraction).toBeCloseTo(16 / 31);
  });
});

describe("project(): burn rate and exhaustion", () => {
  it("projects month end from the month-to-date average", () => {
    // $800 over 16 days = $50/day; 31 days -> $1,550.
    const p = project(800, 2000, null, NOW);
    expect(p.burnPerDay).toBeCloseTo(50);
    expect(p.projectedMonth).toBeCloseTo(1550);
    expect(p.projectedPct).toBeCloseTo(77.5);
  });

  it("prefers the recent 7-day rate for the runs-out date", () => {
    // $1,000 spent of $2,000 with $100/day recent: 10 days left.
    const p = project(1000, 2000, 100, NOW);
    expect(p.daysToExhaust).toBeCloseTo(10);
    expect(p.exhaustDate).toBe(new Date(NOW.getTime() + 10 * 86_400_000).toISOString());
  });

  it("returns null everywhere when inputs are missing", () => {
    const p = project(null, 2000, 10, NOW);
    expect(p.burnPerDay).toBeNull();
    expect(p.projectedMonth).toBeNull();
    expect(p.daysToExhaust).toBeNull();
    const q = project(100, null, 10, NOW);
    expect(q.projectedPct).toBeNull();
    expect(q.daysToExhaust).toBeNull();
  });

  it("is zero days left when already over budget", () => {
    const p = project(2500, 2000, 40, NOW);
    expect(p.daysToExhaust).toBe(0);
  });

  it("uses the month average when there is no recent rate", () => {
    const p = project(800, 2000, 0, NOW);
    expect(p.daysToExhaust).toBeCloseTo((2000 - 800) / 50);
  });
});

describe("heat buckets", () => {
  it("maps percentages to colour buckets", () => {
    expect(heat(null)).toBe("none");
    expect(heat(40)).toBe("ok");
    expect(heat(80)).toBe("warn");
    expect(heat(95)).toBe("hot");
    expect(heat(100)).toBe("over");
    expect(heat(160)).toBe("over");
  });
});

describe("plain-language sentences", () => {
  it("names an over-budget project with its daily burn", () => {
    const s = budgetSentence("aurora", { name: "aurora", projects: [], amount: 2500, spend_this_month: 4000, pct: 160, per_day_7d: 90 } as never, NOW);
    expect(s).toContain("aurora is at 160% of budget");
    expect(s).toContain("burning $90.00 gross/day");
  });

  it("says when a budget runs out at the recent rate", () => {
    const s = budgetSentence("basalt", { name: "basalt", projects: [], amount: 3000, spend_this_month: 1800, pct: 60, per_day_7d: 100 } as never, NOW);
    expect(s).toContain("runs out around");
    expect(s).toContain("12 days");
  });

  it("admits when numbers are missing", () => {
    expect(budgetSentence("x", { name: "x", projects: [], amount: null, spend_this_month: null, pct: null, per_day_7d: null } as never, NOW)).toContain("not reported");
  });

  it("turns Skywalker findings into insights, alerts first, and de-duplicates", () => {
    const list = projectInsights(
      {
        project_id: "p",
        findings: [
          { level: "info", area: "compute", text: "2 of 4 VMs running" },
          { level: "alert", area: "iam", text: "allUsers holds roles/run.invoker" },
          { level: "alert", area: "iam", text: "allUsers holds roles/run.invoker" },
        ],
        budget: { budgets: [{ name: "lab", projects: ["p"], amount: 1000, spend_this_month: 1200, pct: 120, per_day_7d: 30 } as never] },
      },
      NOW,
    );
    expect(list[0].level).toBe("alert");
    expect(list.filter((i) => i.text.startsWith("allUsers")).length).toBe(1);
    expect(list.some((i) => i.area === "budget")).toBe(true);
  });

  it("computeSentence reports only what it knows", () => {
    expect(computeSentence(null)).toBeNull();
    expect(computeSentence({ vms: 5, vms_running: 3, vms_with_gpu: 0, gpus_running: ["1x a100"], unattached_disks: 2, unattached_disk_gb: 340, unused_external_ips: 0, snapshots: 0, snapshot_stored_gb: 0 } as never)).toBe(
      "3 of 5 VMs running; GPUs: 1x a100; 2 unattached disks still billing (340 GB)",
    );
  });

  it("fleetSummary shows -- style honesty for absent data", () => {
    expect(fleetSummary({ gross: null, net: null }, { over: null, warn: null })).toBe("Waiting for data from Skywalker");
    expect(fleetSummary({ gross: 100, net: 80 }, { over: 2, warn: 1 })).toBe("$100 gross this month · 2 budgets over 100% · 1 at 75 to 100%");
  });
});
