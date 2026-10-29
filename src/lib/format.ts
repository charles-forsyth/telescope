// Formatting helpers. Every number on screen passes through here. Missing values
// become "--"; nothing is ever invented.

export const DASH = "--";

type Num = number | null | undefined;

export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function money(v: Num, opts: { cents?: boolean; whole?: boolean } = {}): string {
  if (!isNum(v)) return DASH;
  const digits = opts.cents ? 2 : 0;
  const abs = Math.abs(v);
  // Show cents below $100 so small numbers stay honest, unless the caller asks for whole dollars.
  const d = abs < 100 && !opts.cents && !opts.whole ? 2 : digits;
  const s = abs.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
  return v < 0 ? `-${s}` : s;
}

/** Gross money: usage at list price before PSSA credits. Every gross figure says so. */
export function moneyG(v: Num, opts: { cents?: boolean } = {}): string {
  return isNum(v) ? `${money(v, opts)} gross` : DASH;
}

/** Net money: gross plus credits (credits are negative). */
export function moneyN(v: Num, opts: { cents?: boolean } = {}): string {
  return isNum(v) ? `${money(v, opts)} net` : DASH;
}

/**
 * Every credit figure on screen goes through here. Credits arrive negative from Skywalker and
 * stay negative everywhere (card, cell, tooltip, insight). Never write money(-credits).
 */
export function creditsText(v: Num): string {
  return money(v);
}

/**
 * Gross + credits = net in whole dollars (cards say "whole dollars"; the cents are in the tooltip data).
 * Example: netLine(11344.4, -10209.56) -> "$11,344 gross, -$10,210 credits = $1,135 net".
 */
export function netLine(gross: Num, credits: Num): string {
  if (!isNum(gross) || !isNum(credits)) return DASH;
  const net = gross + credits;
  const w = { whole: true };
  return `${money(gross, w)} gross, ${money(credits, w)} credits = ${money(net, w)} net`;
}

export function moneyCompact(v: Num): string {
  if (!isNum(v)) return DASH;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return money(v);
}

export function pct(v: Num, digits = 0): string {
  if (!isNum(v)) return DASH;
  return `${v.toFixed(digits)}%`;
}

export function int(v: Num): string {
  if (!isNum(v)) return DASH;
  return Math.round(v).toLocaleString("en-US");
}

export function gb(v: Num): string {
  if (!isNum(v)) return DASH;
  if (v >= 1024) return `${(v / 1024).toFixed(v >= 10240 ? 0 : 1)} TB`;
  return `${Math.round(v).toLocaleString("en-US")} GB`;
}

export function days(v: Num): string {
  if (!isNum(v)) return DASH;
  if (v < 1) return "<1 day";
  return `${Math.round(v)} day${Math.round(v) === 1 ? "" : "s"}`;
}

/** "3 min ago", "2 h ago", "4 d ago". Input is epoch milliseconds. */
export function ago(ms: Num, now: number): string {
  if (!isNum(ms)) return DASH;
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** Whole days between an ISO timestamp and now (null if unparseable). */
export function ageDays(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / 86_400_000);
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return DASH;
  return t.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function shortTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return DASH;
  return t.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Strip the "projects/x/" prefixes that Google resource names carry. */
export function shortResource(name: string | null | undefined): string {
  if (!name) return DASH;
  const parts = name.split("/");
  return parts[parts.length - 1] || name;
}

export function signedPct(v: Num, digits = 0): string {
  if (!isNum(v)) return DASH;
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function signedMoney(v: Num): string {
  if (!isNum(v)) return DASH;
  return `${v > 0 ? "+" : ""}${money(v)}`;
}

/**
 * The shared prefix of project ids, cut at the last dash, so "demo-lab-aurora" and
 * "demo-lab-basalt" share "demo-lab-". Show the rest; put the full id in a title.
 */
export function commonPrefix(ids: string[]): string {
  if (ids.length < 2) return "";
  let p = ids[0];
  for (const s of ids) while (!s.startsWith(p)) p = p.slice(0, -1);
  return p.slice(0, p.lastIndexOf("-") + 1);
}
