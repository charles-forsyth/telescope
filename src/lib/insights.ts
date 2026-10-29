// Burn-rate and budget projections, and plain-language insights computed from
// Skywalker data. Pure functions only: they never invent a figure. If an input is
// missing, the output is null and the UI shows "--".
import { DASH, days, gb, int, isNum, money, moneyCompact, pct } from "./format";

export type Level = "alert" | "warn" | "info" | "good";

export interface Insight {
  level: Level;
  area: string;
  text: string;
}

/** Days in the Pacific billing month containing `now`, and the day-of-month. */
export function monthProgress(now: Date): { day: number; daysInMonth: number; fraction: number } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = Math.max(1, now.getUTCDate());
  return { day, daysInMonth, fraction: day / daysInMonth };
}

export interface Projection {
  /** Gross spent so far this month. */
  spent: number | null;
  /** Average spend per day so far this month (spent / elapsed days). */
  burnPerDay: number | null;
  /** Projected month-end spend at the average rate. */
  projectedMonth: number | null;
  /** Budget amount. */
  budget: number | null;
  /** Projected month-end as % of budget. */
  projectedPct: number | null;
  /** Days from now until the budget runs out at the recent 7-day rate, or null. */
  daysToExhaust: number | null;
  /** Date (ISO) the budget runs out at the recent rate, or null. */
  exhaustDate: string | null;
  /** Spend rate in the last 7 days per day, if known. */
  recentPerDay: number | null;
}

/**
 * Project one budget. `recentPerDay` is the last-7-days rate from Skywalker
 * (budget.budgets[].per_day_7d); if absent we fall back to the month average.
 */
export function project(
  spent: number | null | undefined,
  budget: number | null | undefined,
  recentPerDay: number | null | undefined,
  now: Date,
): Projection {
  const mp = monthProgress(now);
  const burnPerDay = isNum(spent) ? spent / mp.day : null;
  const projectedMonth = isNum(burnPerDay) ? burnPerDay * mp.daysInMonth : null;
  const projectedPct = isNum(projectedMonth) && isNum(budget) && budget > 0 ? (projectedMonth / budget) * 100 : null;
  let daysToExhaust: number | null = null;
  let exhaustDate: string | null = null;
  const rate = isNum(recentPerDay) && recentPerDay > 0 ? recentPerDay : burnPerDay;
  if (isNum(spent) && isNum(budget) && isNum(rate) && rate > 0) {
    const left = budget - spent;
    if (left <= 0) {
      daysToExhaust = 0;
      exhaustDate = now.toISOString();
    } else {
      daysToExhaust = left / rate;
      exhaustDate = new Date(now.getTime() + daysToExhaust * 86_400_000).toISOString();
    }
  }
  return {
    spent: isNum(spent) ? spent : null,
    burnPerDay,
    projectedMonth,
    budget: isNum(budget) ? budget : null,
    projectedPct,
    daysToExhaust,
    exhaustDate,
    recentPerDay: isNum(recentPerDay) ? recentPerDay : null,
  };
}

/** Heat colour bucket for a percentage of budget used. */
export function heat(p: number | null | undefined): "none" | "ok" | "warn" | "hot" | "over" {
  if (!isNum(p)) return "none";
  if (p >= 100) return "over";
  if (p >= 90) return "hot";
  if (p >= 75) return "warn";
  return "ok";
}

export interface BudgetRow {
  id?: string;
  name: string;
  projects: string[];
  amount: number | null;
  spend_this_month: number | null;
  pct: number | null;
  per_day_7d: number | null;
  period?: string;
  spend_basis?: string;
}

/** A sentence for one budget, using only the numbers Skywalker sent. */
export function budgetSentence(name: string, b: BudgetRow, now: Date): string {
  const p = project(b.spend_this_month, b.amount, b.per_day_7d, now);
  if (!isNum(b.pct)) return `${name}: spend or budget amount not reported`;
  if (b.pct >= 100) {
    const burn = isNum(p.recentPerDay) ? `, burning ${money(p.recentPerDay)} gross/day over the last 7 days` : "";
    return `${name} is at ${pct(b.pct)} of budget (${money(b.spend_this_month)} of ${money(b.amount)})${burn}`;
  }
  if (isNum(p.daysToExhaust) && typeof p.exhaustDate === "string") {
    const when = new Date(p.exhaustDate).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const rate = isNum(p.recentPerDay) ? `${money(p.recentPerDay)} gross/day over the last 7 days` : `${money(p.burnPerDay)} gross/day on the month average`;
    return `${name} is at ${pct(b.pct)}; at ${rate} it runs out around ${when} (${days(p.daysToExhaust)})`;
  }
  return `${name} is at ${pct(b.pct)} of budget`;
}

/** Projected month-end spend if known, else "--". */
export function projectedText(p: Projection): string {
  return isNum(p.projectedMonth) ? `${moneyCompact(p.projectedMonth)} projected` : `${DASH} projected`;
}

// ---- Skywalker result shapes we read (only the fields we use) -------------------

export interface OverviewData {
  project_id: string;
  findings?: { level: string; area: string; text: string }[];
  project?: { name?: string; billing_enabled?: boolean | null; labels?: Record<string, string>; state?: string; created?: string };
  spend?: { total?: { gross: number; credits: number; net: number }; window?: { label: string } };
  budget?: { budgets?: BudgetRow[]; summary?: Record<string, unknown> };
  compute?: { summary?: ComputeSummary };
  exposure?: { risks?: string[] };
  access?: { flagged?: { member: string; roles: string[]; flags: string[] }[] };
  service_accounts?: { old_keys?: number; keys_older_than_days?: number };
  api_keys?: { keys?: number; unrestricted?: number };
  recommendations?: { total_monthly_saving?: number };
  unavailable?: Record<string, { error: string; message: string }>;
}

export interface ComputeSummary {
  vms: number;
  vms_running: number;
  vms_with_gpu: number;
  gpus_running: string[];
  unattached_disks: number;
  unattached_disk_gb: number;
  unused_external_ips: number;
  snapshots: number;
  snapshot_stored_gb: number;
}

/**
 * The project-level insight list. The server already computes findings; we add
 * the burn-rate sentence and the budget-exhaust date so the page reads like a
 * briefing. Only sentences built from real numbers are emitted.
 */
export function projectInsights(o: OverviewData, now: Date): Insight[] {
  const out: Insight[] = [];
  const bud = o.budget?.budgets ?? [];
  for (const b of bud) {
    out.push({ level: budgetLevel(b.pct), area: "budget", text: budgetSentence(b.name, b, now) });
  }
  for (const f of o.findings ?? []) {
    const level: Level = f.level === "alert" ? "alert" : f.level === "warn" ? "warn" : "info";
    out.push({ level, area: f.area, text: f.text });
  }
  return dedupe(out);
}

function budgetLevel(p: number | null | undefined): Level {
  const h = heat(p);
  return h === "over" || h === "hot" ? "alert" : h === "warn" ? "warn" : "info";
}

function dedupe(list: Insight[]): Insight[] {
  const seen = new Set<string>();
  return list.filter((i) => (seen.has(i.text) ? false : (seen.add(i.text), true)));
}

/** A plain sentence for a compute summary, or null if there is nothing to say. */
export function computeSentence(c: ComputeSummary | undefined | null): string | null {
  if (!c) return null;
  const parts: string[] = [];
  if (isNum(c.vms_running) && isNum(c.vms)) parts.push(`${int(c.vms_running)} of ${int(c.vms)} VMs running`);
  if (c.gpus_running?.length) parts.push(`GPUs: ${c.gpus_running.join(", ")}`);
  if (isNum(c.unattached_disk_gb) && c.unattached_disk_gb >= 100) {
    parts.push(`${int(c.unattached_disks)} unattached disks still billing (${gb(c.unattached_disk_gb)})`);
  }
  return parts.length ? parts.join("; ") : null;
}

/** Fleet-level rollup sentence. */
export function fleetSummary(total: { gross: number | null; net: number | null }, budgets: { over: number | null; warn: number | null }): string {
  const parts: string[] = [];
  if (isNum(total.gross)) parts.push(`${money(total.gross)} gross this month`);
  if (isNum(budgets.over)) parts.push(`${int(budgets.over)} budget${budgets.over === 1 ? "" : "s"} over 100%`);
  if (isNum(budgets.warn)) parts.push(`${int(budgets.warn)} at 75 to 100%`);
  return parts.length ? parts.join(" · ") : "Waiting for data from Skywalker";
}
