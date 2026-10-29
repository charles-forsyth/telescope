// PSSA (Public Sector Subscription Agreement) maths. Pure functions over Skywalker's
// spend_all answers. Nothing here estimates: if a figure cannot be computed from the
// answer, it is null and the UI shows "--".
//
// Money basis (Skywalker, billing.py):
//   gross   = usage at list price before credits
//   credits = negative (PSSA subscription benefit and other discounts; NOT split by type)
//   net     = gross + credits
// The account-level fee has no project. Skywalker labels that row "(none)".

import { isNum } from "./format";

export interface SpendAll {
  window: { label: string };
  total: { gross: number; credits: number; net: number };
  items: { project?: string; gross: number; credits: number; net: number }[];
  truncated?: boolean;
}

export const isAccountLevel = (p?: string) => !p || p === "(none)";

export interface MonthRow {
  month: string;
  /** Account-level subscription fee, gross (no project). */
  fee: number | null;
  /** Project usage at list price, gross (total gross minus the fee). */
  usageGross: number | null;
  /** ALL credit types combined, negative as Skywalker sends them (whole account). */
  credits: number | null;
  /** Whole-account net, as Skywalker reports it (gross + credits, fee included). */
  net: number | null;
  /** Project usage, net of credits (sum of net over project rows only). */
  usageNet: number | null;
  /** Credits applied to project rows only (negative). Usage gross = usageNet - usageCredits. */
  usageCredits: number | null;
  /** Credits on the account-level row, if any (negative). Usually 0. */
  feeCredits: number | null;
  /** All credits / fee. Credit types are not split, so this is "all credit types" only. */
  ratio: number | null;
}

/**
 * One month from a spend_all(group_by=project) answer. A truncated answer is not
 * trusted (the account-level row could be cut off), so every figure is null.
 */
export function monthRow(month: string, r: SpendAll | null | undefined): MonthRow {
  const empty = { month, fee: null, usageGross: null, credits: null, net: null, usageNet: null, usageCredits: null, feeCredits: null, ratio: null };
  if (!r || r.truncated || !r.total) return empty;
  const acct = r.items.filter((i) => isAccountLevel(i.project));
  const proj = r.items.filter((i) => !isAccountLevel(i.project));
  const fee = acct.reduce((s, i) => s + i.gross, 0);
  const usageGross = proj.reduce((s, i) => s + i.gross, 0);
  const usageNet = proj.reduce((s, i) => s + i.net, 0);
  const usageCredits = proj.reduce((s, i) => s + i.credits, 0);
  const feeCredits = acct.reduce((s, i) => s + i.credits, 0);
  const ratio = fee > 0 ? -r.total.credits / fee : null; // ALL credits / fee (types not split)
  return { month, fee, usageGross, credits: r.total.credits, net: r.total.net, usageNet, usageCredits, feeCredits, ratio };
}

/** Per-project rows from one month, account-level excluded, sorted by credits consumed. */
export interface ProjectRow {
  project: string;
  gross: number;
  credits: number;
  net: number;
}

export function projectRows(r: SpendAll | null | undefined): ProjectRow[] {
  if (!r || !r.items) return [];
  return r.items
    .filter((i) => !isAccountLevel(i.project))
    .map((i) => ({ project: i.project as string, gross: i.gross, credits: i.credits, net: i.net }))
    .sort((a, b) => a.credits - b.credits); // most negative (most credit consumed) first
}

/** Month-to-date pace: credits so far this month vs last month at the same day. */
export function paceVsLast(thisSoFar: number | null, lastSameDay: number | null): number | null {
  if (!isNum(thisSoFar) || !isNum(lastSameDay) || lastSameDay === 0) return null;
  return (thisSoFar / lastSameDay - 1) * 100;
}

/** How many projects it takes to reach `threshold` (0..1) of total credits consumed. */
export function topShare(rows: ProjectRow[], threshold = 0.8): { share: number; count: number } | null {
  const total = rows.reduce((s, r) => s + r.credits, 0);
  if (!isNum(total) || total === 0) return null;
  let acc = 0;
  let count = 0;
  for (const r of rows) {
    acc += r.credits;
    count += 1;
    if (acc / total >= threshold) break;
  }
  return { share: (acc / total) * 100, count };
}

/** "YYYY-MM" for the month `back` months before `now`, in Pacific time (billing days). */
export function pacificMonth(now: Date, back = 0): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit" }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Last `count` months ending at (and including) the current Pacific month, oldest first. */
export function recentMonths(now: Date, count: number): string[] {
  const out: string[] = [];
  for (let b = count - 1; b >= 0; b--) out.push(pacificMonth(now, b));
  return out;
}

/**
 * Billing insights from the PSSA numbers only (review item 15). Each sentence names its basis.
 * A sentence is left out when a figure it needs is missing, so nothing is estimated.
 * `day` is the day of the month so far and `daysInMonth` the month length (Pacific billing month).
 */
export function pssaInsights(cur: MonthRow | null, projects: ProjectRow[], day: number, daysInMonth: number): string[] {
  const out: string[] = [];
  if (!cur || !isNum(cur.fee) || cur.fee <= 0 || !isNum(cur.credits)) return out;
  const credits = -cur.credits; // positive amount of credits so far, all types
  out.push(`Fee minus credits so far = ${money0(cur.fee - credits)} of subscription value not yet used (all credit types)`);
  if (day > 0 && credits > 0) {
    const closing = (credits / day) * daysInMonth;
    out.push(`At the month-to-date daily credit rate the month closes near ${Math.round((closing / cur.fee) * 100)}% of the fee (projection, all credit types)`);
  }
  const total = projects.reduce((s, r) => s + r.credits, 0);
  if (projects.length >= 3 && total < 0) {
    const share = (projects.slice(0, 3).reduce((s, r) => s + r.credits, 0) / total) * 100;
    out.push(`Top 3 projects hold ${Math.round(share)}% of credits (all credit types)`);
  }
  if (isNum(cur.usageGross) && cur.usageGross > 0) {
    out.push(`Usage gross is ${Math.round((cur.usageGross / cur.fee) * 100)}% of the fee`);
  }
  return out;
}

/**
 * How one usage bar is drawn (review item 4). A stacked bar is net + credits consumed = gross, which only
 * holds while net >= 0. When credits exceed usage (net < 0) the bar is drawn as ONE gross bar with an
 * `over` marker, so no bar ever sits below zero. The signed net stays in the tooltip.
 */
export function usageBar(gross: number | null | undefined, credits: number | null | undefined): { net: number | null; consumed: number | null; over: boolean } {
  if (!isNum(gross) || !isNum(credits)) return { net: null, consumed: null, over: false };
  const net = Math.round((gross + credits) * 100) / 100;
  // Credits exceed usage: every dollar of usage was covered, so the whole bar is "credits consumed" and the
  // net segment is 0. (Drawing it as `net: gross` painted fully-covered months as amber "Usage net" bars.)
  if (net < 0) return { net: 0, consumed: gross, over: true };
  return { net, consumed: Math.abs(credits), over: false };
}

/**
 * Chart series for the per-project bars. net and consumed are never negative and net + consumed === gross
 * for every row. `below` is the signed net when credits exceed usage (else 0): it is drawn left of zero.
 * Rows keep the input order; the caller decides the sort and the slice.
 */
export function projectBars(rows: ProjectRow[]): { project: string; net: number | null; consumed: number | null; below: number; over: boolean }[] {
  return rows.map((r) => {
    const b = usageBar(r.gross, r.credits);
    // Credits exceed usage: every dollar of usage was covered, so the whole gross bar is "credits consumed"
    // (net 0). The shortfall (net, negative) is its own series drawn left of zero, named in the legend.
    if (b.over && isNum(r.gross)) return { project: r.project, net: 0, consumed: r.gross, below: Math.round((r.gross + (r.credits as number)) * 100) / 100, over: true };
    return { project: r.project, net: b.net, consumed: b.consumed, below: 0, over: false };
  });
}

const money0 = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

/** Short project id: the common prefix is stated once in the section sub, not per row. */
export function shortId(id: string, prefix: string): string {
  return prefix && id.startsWith(prefix) ? id.slice(prefix.length) || id : id;
}
