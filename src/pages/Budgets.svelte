<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import Section from "../components/Section.svelte";
  import Bullet from "../components/Bullet.svelte";
  import Table from "../components/Table.svelte";
  import Insights from "../components/Insights.svelte";
  import { query } from "../lib/query.svelte";
  import { money, moneyCompact, moneyG, int, pct, DASH, isNum, commonPrefix } from "../lib/format";
  import { shortId } from "../lib/pssa";
  import { C, heatColor } from "../lib/palette";
  import { heat, project, budgetSentence, type BudgetRow, type Insight } from "../lib/insights";
  import { projectPath, router } from "../lib/router.svelte";
  import { now } from "../lib/clock.svelte";

  interface BudgetsData {
    month: string;
    summary: Record<string, number>;
    budgets: BudgetRow[];
    unbudgeted: { project_id: string; gross_this_month: number; per_day_7d: number }[];
    note?: string;
  }

  const data = query<BudgetsData>("skywalker_budgets", () => ({ limit: 500 }), { refreshEveryMs: 5 * 60_000 });
  onMount(() => void data.refresh());
  onDestroy(() => data.stop());

  let sortKey = $state("pct");
  let sortDir = $state<"asc" | "desc">("desc");
  let filter = $state<"all" | "over" | "warn" | "ok" | "nobudget">("all");

  const nowDate = $derived(new Date(now.value));
  // End of the current billing month (Pacific): the run-out date past this is "after period end".
  const periodEnd = $derived(new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() + 1, 1)));

  const rows = $derived(
    (data.data?.budgets ?? []).map((b) => {
      const p = project(b.spend_this_month, b.amount, b.per_day_7d, nowDate);
      const proj = b.projects?.[0] ?? b.name;
      return {
        ...b,
        _proj: proj,
        _p: p,
        _heat: heat(b.pct),
        _sentence: budgetSentence(b.name, b, nowDate),
        _remaining: isNum(b.amount) && isNum(b.spend_this_month) ? b.amount - b.spend_this_month : null,
      };
    }),
  );
  // Projects spending with no budget (review item 6). Budget, Left, Used and Runs out are "--" by design:
  // there is no budget to measure against, so nothing is estimated.
  const unbudgetedRows = $derived(
    (data.data?.unbudgeted ?? []).map((u) => ({
      id: `unb-${u.project_id}`,
      name: "no budget",
      _proj: u.project_id,
      amount: null as number | null,
      spend_this_month: u.gross_this_month,
      spend_basis: "no budget",
      per_day_7d: u.per_day_7d,
      pct: null as number | null,
      _remaining: null as number | null,
      _heat: "none" as const,
      _sentence: `${u.project_id} has no budget`,
      _p: { projectedMonth: null as number | null, daysToExhaust: null as number | null, exhaustDate: null as string | null },
    })),
  );
  // Ids share one prefix: state it once in the section sub and show only the rest per row.
  const idPrefix = $derived(commonPrefix([...rows.map((r) => r._proj), ...unbudgetedRows.map((r) => r._proj)]));
  // Heat bars share one scale: 100% or the highest budget, plus 5% room so an overflow bar still ends
  // before the track end (review item 7). The same rule as the Fleet Budgets card.
  const heatScale = $derived(Math.max(100, ...rows.map((r) => (isNum(r.pct) ? r.pct : 0))) * 1.05);
  const filtered = $derived.by(() => {
    if (filter === "nobudget") return unbudgetedRows;
    if (filter === "all") return [...rows, ...unbudgetedRows];
    return rows.filter((r) => (filter === "over" ? r._heat === "over" : filter === "warn" ? r._heat === "warn" || r._heat === "hot" : r._heat === "ok"));
  });

  const insights = $derived.by<Insight[]>(() => {
    const out: Insight[] = [];
    const over = rows.filter((r) => r._heat === "over");
    for (const r of over) out.push({ level: "alert", area: "over budget", text: r._sentence });
    for (const r of rows.filter((x) => x._heat === "hot" || x._heat === "warn")) out.push({ level: "warn", area: "approaching", text: r._sentence });
    for (const u of data.data?.unbudgeted ?? []) {
      if (u.gross_this_month >= 100) out.push({ level: "warn", area: "no budget", text: `${u.project_id} has spent ${moneyG(u.gross_this_month)} this month and has no budget` });
    }
    return out;
  });

  const totals = $derived.by(() => {
    const amt = rows.reduce((s, r) => s + (isNum(r.amount) ? r.amount : 0), 0);
    const spent = rows.reduce((s, r) => s + (isNum(r.spend_this_month) ? r.spend_this_month : 0), 0);
    const hasAmt = rows.some((r) => isNum(r.amount));
    return { amt: hasAmt ? amt : null, spent: rows.some((r) => isNum(r.spend_this_month)) ? spent : null };
  });

  /** Short date; adds the year when the date is more than 6 months away, so "Sep 9" is never ambiguous. */
  function runsOut(iso: string | null): string {
    if (!iso) return DASH;
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return DASH;
    const far = t.getTime() - nowDate.getTime() > 183 * 86_400_000;
    return t.toLocaleDateString("en-US", far ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });
  }

  /** Run-out cell: once a budget is at or past 100% it has no future run-out date. */
  function runsOutCell(r: { pct: number | null; _p: { daysToExhaust: number | null; exhaustDate: string | null } }, periodEnd: Date): string {
    if (isNum(r.pct) && r.pct >= 100) return `over since ${runsOut(r._p.exhaustDate ?? null)}`;
    if (!r._p.exhaustDate) return DASH;
    const t = new Date(r._p.exhaustDate);
    if (!Number.isNaN(t.getTime()) && t.getTime() > periodEnd.getTime()) return "after period end";
    return runsOut(r._p.exhaustDate);
  }

  function open(pid: string) {
    router.go(projectPath(pid, "spend"));
  }
</script>

<div class="grid g4" style="margin-bottom:14px">
  <div class="card"><div class="kpi-label">Budgets</div><div class="hero sm num">{data.data ? int(data.data.summary?.budgets) : DASH}</div><div class="kpi-sub">on the billing account</div></div>
  <div class="card"><div class="kpi-label">Over 100%</div><div class="hero sm num" style="color:{(data.data?.summary?.over_100pct ?? 0) > 0 ? C.alert : 'inherit'}">{data.data ? int(data.data.summary?.over_100pct) : DASH}</div></div>
  <div class="card"><div class="kpi-label">75 to 100%</div><div class="hero sm num" style="color:{(data.data?.summary?.["75_to_100pct"] ?? 0) > 0 ? C.warn : 'inherit'}">{data.data ? int(data.data.summary?.["75_to_100pct"]) : DASH}</div></div>
  <div class="card"><div class="kpi-label">Spend without a budget</div><div class="hero sm num">{data.data ? int(data.data.summary?.unbudgeted_spenders) : DASH}</div><div class="kpi-sub">projects spending with no budget</div></div>
</div>

<div class="grid g2" style="grid-template-columns: 1fr 1.4fr">
  <Section title="What to know" sub="from the budget figures" loading={data.loading && !data.data} error={data.error} empty={!data.data} emptyText="Loading budgets…" ago="">
    <Insights items={insights} limit={10} empty="No budget is over 75%. Good." />
    {#if totals.amt !== null}
      <div class="tiny faint" style="margin-top:12px">Budgeted in total {money(totals.amt)} · spent so far {money(totals.spent)} (each budget's basis is in its row: gross or net)</div>
    {/if}
  </Section>

  <Section title="Budget heat" sub="each bar is % of budget used" loading={data.loading && !data.data} error={null} empty={!rows.length} emptyText="No budgets with an amount." ago="">
    <div class="heat">
      {#each [...rows].sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1)).slice(0, 14) as r (r.id ?? r.name)}
        <button class="heat-row" onclick={() => open(r._proj)} title={r._sentence}>
          <span class="mono heat-name" title={r._proj}>{shortId(r._proj, idPrefix)}</span>
          <span class="heat-bar"><Bullet value={r.pct} scaleMax={heatScale} fill={heatColor(r.pct)} /></span>
          <span class="num heat-pct" style="color:{heatColor(r.pct)}">{pct(r.pct)}</span>
        </button>
      {:else}
        <div class="empty">--</div>
      {/each}
    </div>
  </Section>
</div>

<div class="grid" style="margin-top:14px">
  <div class="budgets-table"><Section title="All budgets" sub={`click a header to sort; click a row to open the project; ids are ${idPrefix || "full"}…; Basis says gross or net`} loading={data.loading && !data.data} error={data.error} empty={!rows.length && !unbudgetedRows.length} emptyText="No budgets." ago="">
    <div class="toolbar">
      <div class="seg" role="group" aria-label="Filter">
        <button class:on={filter === "all"} onclick={() => (filter = "all")}>All</button>
        <button class:on={filter === "over"} onclick={() => (filter = "over")}>Over 100%</button>
        <button class:on={filter === "warn"} onclick={() => (filter = "warn")}>75 to 100%</button>
        <button class:on={filter === "ok"} onclick={() => (filter = "ok")}>Under 75%</button>
        <button class:on={filter === "nobudget"} onclick={() => (filter = "nobudget")}>No budget ({unbudgetedRows.length})</button>
      </div>
      <span class="spacer"></span>
      <span class="tiny faint">{filtered.length} shown</span>
    </div>
    <Table rows={filtered} bind:sortKey bind:sortDir rowKey={(r) => r.id ?? r.name} onRow={(r) => open(r._proj)} cols={[
      { key: "proj", label: "Project", value: (r) => r._proj, fmt: (r) => shortId(r._proj, idPrefix), sub: (r) => r.name, wrap: false },
      { key: "amt", label: "Budget amount", value: (r) => r.amount, fmt: (r) => money(r.amount), align: "r", nowrap: true },
      { key: "spent", label: "Spent", value: (r) => r.spend_this_month, fmt: (r) => money(r.spend_this_month), align: "r" },
      { key: "left", label: "Left", value: (r) => r._remaining, fmt: (r) => (r._remaining === null ? DASH : money(r._remaining)), align: "r" },
      { key: "pct", label: "Used", value: (r) => r.pct, fmt: (r) => pct(r.pct), align: "r" },
      { key: "rate", label: "Per day, last 7d", value: (r) => r.per_day_7d, fmt: (r) => money(r.per_day_7d), align: "r" },
      { key: "run", label: "Runs out", value: (r) => r._p.daysToExhaust, fmt: (r) => (r.pct === null ? DASH : runsOutCell(r, periodEnd)), align: "r" },
      { key: "proj30", label: "Projected month end", value: (r) => r._p.projectedMonth, fmt: (r) => (r.amount === null ? DASH : moneyCompact(r._p.projectedMonth)), sub: (r) => (r.spend_basis === "net" ? "net basis" : null), align: "r" },
      { key: "basis", label: "Basis", nowrap: true, align: "r", value: (r) => r.spend_basis ?? "", fmt: (r) => r.spend_basis ?? DASH, pill: (r) => (r.spend_basis === "gross" ? "muted" : r.spend_basis === "net" ? "accent" : r.spend_basis === "no budget" ? "none" : null) },
    ]} />
    <div class="tiny faint" style="margin-top:12px">{data.data?.note ?? ""}</div>
  </Section></div>
</div>

<style>
  /* The seven-column budget table is dense; at 1280 the Basis column must not be cropped. */
  .budgets-table :global(td), .budgets-table :global(th) { padding-left: 8px; padding-right: 8px; }
  .toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
  .heat { display: grid; gap: 6px; }
  .heat-row { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(120px, 2fr) 64px; gap: 12px; align-items: center; background: transparent; border: 0; padding: 5px 6px; border-radius: 9px; color: inherit; text-align: left; transition: background 0.15s var(--ease); }
  .heat-row:hover { background: var(--surface-2); }
  .heat-name { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .heat-pct { text-align: right; font-weight: 600; }
  .seg button.on { font-weight: 600; }
  :global(td.num), :global(th.r) { white-space: nowrap; font-variant-numeric: tabular-nums; }
  :global(td.nowrap) { white-space: nowrap; }
  :global(td .tiny) { display: block; margin-top: 2px; font-weight: 400; }
</style>
