import { describe, expect, it } from "vitest";
import { moneyG, moneyN, creditsText, netLine } from "./format";
import { budgetSentence, projectInsights, fleetSummary } from "./insights";
import { monthRow, type SpendAll } from "./pssa";

const NOW = new Date(Date.UTC(2026, 9, 16, 12));

describe("every money figure says gross or net", () => {
  it("moneyG and moneyN append the basis word", () => {
    expect(moneyG(1234.5)).toBe("$1,235 gross");
    expect(moneyN(-40)).toBe("-$40.00 net");
    expect(moneyG(null)).toBe("--");
    expect(moneyN(undefined)).toBe("--");
  });

  it("credits stay negative everywhere (review item 2)", () => {
    expect(creditsText(-198_000)).toBe("-$198,000");
    expect(creditsText(null)).toBe("--");
  });

  it("the arithmetic line shows whole dollars on all three numbers (round 8 item 5)", () => {
    expect(netLine(11344.4, -10209.56)).toBe("$11,344 gross, -$10,210 credits = $1,135 net");
    expect(netLine(null, -1)).toBe("--");
  });

  it("budget sentences name the amount with a money figure that carries a basis word", () => {
    // Budget sentences state gross figures where they burn per day; the spend figure is the basis of the budget.
    const s = budgetSentence("aurora", { name: "aurora", projects: [], amount: 2500, spend_this_month: 4000, pct: 160, per_day_7d: 90 } as never, NOW);
    expect(s).toContain("burning $90.00 gross/day");
  });

  it("fleet summary labels its gross total", () => {
    expect(fleetSummary({ gross: 100, net: 80 }, { over: 0, warn: 0 })).toContain("gross this month");
  });

  it("the PSSA card line uses 'all types' for credits, never a bare credits figure", () => {
    const oct: SpendAll = {
      window: { label: "2026-10" },
      total: { gross: 352_000, credits: -198_000, net: 154_000 },
      items: [{ project: "(none)", gross: 142_000, credits: 0, net: 142_000 }, { project: "p", gross: 210_000, credits: -198_000, net: 12_000 }],
      truncated: false,
    };
    const r = monthRow("2026-10", oct);
    expect(r.ratio).toBeCloseTo(198_000 / 142_000);
    expect(creditsText(r.credits)).toBe("-$198,000");
  });

  it("project insights never invent a money figure without a basis in their sentence", () => {
    const list = projectInsights(
      { project_id: "p", budget: { budgets: [{ name: "lab", projects: ["p"], amount: 1000, spend_this_month: 1200, pct: 120, per_day_7d: 30 } as never] } },
      NOW,
    );
    const money = list.filter((i) => /\$\d/.test(i.text));
    expect(money.length).toBeGreaterThan(0);
  });
});

describe("review round 3: labels and credit honesty", () => {
  it("no page says the bare phrase 'Net, all' (it reads as if credits raised net)", () => {
    const pages = import.meta.glob("../pages/*.svelte", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    for (const [file, text] of Object.entries(pages)) {
      expect(text, file).not.toContain("Net, all");
    }
  });

  it("the Billing and Fleet net labels name the account-level charges (review item 5)", () => {
    const pages = import.meta.glob("../pages/{Billing,Fleet}.svelte", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    for (const text of Object.values(pages)) {
      expect(text).toContain("Net incl. account-level");
      expect(text).not.toContain("Net incl. fee");
    }
  });

  it("the account-level row is named subscription fee + support, never just the fee (review item 5)", () => {
    const pages = import.meta.glob("../pages/{Billing,Fleet}.svelte", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    for (const [file, text] of Object.entries(pages)) {
      expect(text, file).toContain("support");
      expect(text, file).not.toMatch(/PSSA subscription fee, account-level/);
      expect(text, file).not.toMatch(/Subscription fee, \{/);
    }
    const billing = Object.values(import.meta.glob("../pages/Billing.svelte", { query: "?raw", import: "default", eager: true }) as Record<string, string>)[0];
    expect(billing).toContain("Skywalker does not split");
  });

  it("the credit-type card is gated on the catalogue and never estimates a split", () => {
    const billing = import.meta.glob("../pages/Billing.svelte", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const text = Object.values(billing)[0];
    expect(text).toContain('hasTool("skywalker_credits")');
    expect(text).not.toMatch(/SUBSCRIPTION_BENEFIT\s*[/*]/);
  });
});

describe("review round 4: credits are negative everywhere (item 2)", () => {
  it("no page negates a credit figure with money(-...): every credit goes through creditsText", () => {
    const pages = import.meta.glob("../pages/*.svelte", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    for (const [file, text] of Object.entries(pages)) {
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        // A money(-x) call that sits near a credit mention is the old, mixed-sign form.
        if (/money\(-/.test(line) && /credit/i.test(line)) {
          throw new Error(`${file}:${i + 1} negates a credit figure: ${line.trim()}`);
        }
      });
    }
  });

  it("the Fleet and Billing pages never write money(-...) at all for credits", () => {
    const pages = import.meta.glob("../pages/{Fleet,Billing,Project,Budgets}.svelte", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    for (const [file, text] of Object.entries(pages)) {
      expect(text, file).not.toMatch(/money\(-[^)]*credit/);
      expect(text, file).not.toMatch(/money\(-\(cur\?\.credits/);
    }
  });
});

describe("review round 4: money arithmetic and burn-rate wording (items 3, 6)", () => {
  it("Fleet net: whole dollars, net rounded from the true net (gross 11344.4, credits -10209.56)", () => {
    // Whole dollars on all three, each rounded from the true value; the net is rounded from the true net.
    const s = netLine(11344.4, -10209.56);
    expect(s).toContain("$11,344 gross");
    expect(s).toContain("-$10,210 credits");
    expect(s).toContain("= $1,135 net");
  });

  it("the 7-day burn rate says so in the budget sentence, and the month average is named as such", () => {
    const withRate = budgetSentence("aurora", { name: "aurora", projects: [], amount: 2500, spend_this_month: 4000, pct: 160, per_day_7d: 90 } as never, NOW);
    expect(withRate).toContain("burning $90.00 gross/day over the last 7 days");
    const noRate = budgetSentence("basalt", { name: "basalt", projects: [], amount: 3000, spend_this_month: 1800, pct: 60, per_day_7d: null } as never, NOW);
    expect(noRate).toContain("on the month average");
    expect(noRate).not.toContain("over the last 7 days");
  });
});


describe("review item 3: no raw net in a bar series", () => {
  it("no bar series is fed by a raw r.net (a stacked bar below zero is the bug; use usageBar or projectBars). The net LINE is allowed.", () => {
    const pages = import.meta.glob("../pages/*.svelte", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    for (const [file, text] of Object.entries(pages)) {
      text.split("\n").forEach((line, i) => {
        if (/type:\s*"bar"/.test(line) && /data:\s*[^\n]*\br\.net\b/.test(line)) {
          throw new Error(`${file}:${i + 1} charts a raw net: ${line.trim()}`);
        }
      });
    }
  });
});
