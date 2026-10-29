<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import Chart from "../components/Chart.svelte";
  import Section from "../components/Section.svelte";
  import Insights from "../components/Insights.svelte";
  import Meter from "../components/Meter.svelte";
  import Bullet from "../components/Bullet.svelte";
  import { query, callOnce } from "../lib/query.svelte";
  import { money, moneyCompact, int, pct, signedPct, days, DASH, isNum, ago, creditsText, netLine } from "../lib/format";
  import { C, SERIES, heatColor } from "../lib/palette";
  import { heat, project as projectBurn, monthProgress, type BudgetRow, type Insight } from "../lib/insights";
  import { isAccountLevel, monthRow, projectRows as pssaProjectRows, pacificMonth, paceVsLast, topShare, shortId, type SpendAll } from "../lib/pssa";
  import { projectPath, router } from "../lib/router.svelte";
  import { commonPrefix } from "../lib/format";
  import { now } from "../lib/clock.svelte";

  interface SpendItem { project?: string; gross: number; credits: number; net: number; }
  interface FleetData {
    scopes?: string[];
    findings?: string[];
    spend_by_project?: { window: { label: string }; total: { gross: number; credits: number; net: number }; items: SpendItem[]; truncated?: boolean };
    trend?: { rising: { project_id: string; gross_last7: number; gross_prev7: number; change: number; change_pct: number | null; per_day_now: number }[]; falling: { project_id: string; change: number; change_pct: number | null }[]; account_level?: { gross_last7: number; gross_prev7: number } };
    budgets?: { summary: Record<string, number>; budgets: BudgetRow[]; unbudgeted: { project_id: string; gross_this_month: number; per_day_7d: number }[] };
    compute?: { running_vms: number; projects_with_running_vms: number; top: { project_id: string; running: number; gpu_like: number }[] };
    public_access?: { resource: string; project: string }[];
    unavailable?: Record<string, { error: string; message: string }>;
  }
  interface BudgetsData { summary: Record<string, number>; budgets: BudgetRow[]; unbudgeted: { project_id: string; gross_this_month: number; per_day_7d: number }[]; month: string; }
  interface DailyData { items: { day: string; gross: number; credits: number; net: number }[]; total: { gross: number; net: number }; window: { label: string }; }

  const fleet = query<FleetData>("skywalker_fleet", () => ({ limit: 25 }), { refreshEveryMs: 5 * 60_000, maxAgeSecs: 300 });
  const budgets = query<BudgetsData>("skywalker_budgets", () => ({ limit: 200 }), { refreshEveryMs: 5 * 60_000, maxAgeSecs: 300 });
  const daily = query<DailyData>("skywalker_spend_all", () => ({ group_by: "day", days: 30, limit: 60 }), { refreshEveryMs: 5 * 60_000, maxAgeSecs: 300 });
  // This month by project: the fee, the treemap, the table and the PSSA pace all come from here.
  const monthAll = query<SpendAll>("skywalker_spend_all", () => ({ group_by: "project", month: pacificMonth(new Date(now.value)), limit: 500 }), { refreshEveryMs: 5 * 60_000, maxAgeSecs: 300 });
  const all = [fleet, budgets, daily, monthAll];
  // Pace (item 6): credits so far this month vs last month at the same Pacific day. Two day-grouped calls,
  // one after the other (never parallel), like Billing.
  let lastDayCredits = $state<{ cur: number | null; prev: number | null }>({ cur: null, prev: null });
  async function loadPace() {
    const today = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", day: "2-digit" }).format(new Date(now.value)));
    const curKey = pacificMonth(new Date(now.value));
    const prevKey = pacificMonth(new Date(now.value), 1);
    const out = { cur: null as number | null, prev: null as number | null };
    try {
      const r = await callOnce<{ items: { day: string; credits: number }[] }>("skywalker_spend_all", { group_by: "day", month: prevKey, limit: 60 }, 21_600);
      out.prev = (r.data.items ?? []).filter((x) => Number(x.day.slice(8, 10)) <= today).reduce((s, x) => s + x.credits, 0);
    } catch { out.prev = null; }
    try {
      const r = await callOnce<{ items: { day: string; credits: number }[] }>("skywalker_spend_all", { group_by: "day", month: curKey, limit: 60 }, 300);
      out.cur = (r.data.items ?? []).reduce((s, x) => s + x.credits, 0);
    } catch { out.cur = null; }
    lastDayCredits = out;
  }
  // The header states the age of the OLDEST answer on the page, so it never overstates freshness.
  const oldestAgo = $derived.by(() => {
    const times = [fleet.fetchedAt, budgets.fetchedAt, daily.fetchedAt, monthAll.fetchedAt].filter((t): t is number => typeof t === "number");
    return times.length === 4 ? ago(Math.min(...times), now.value) : "--";
  });

  // One call at a time, never three at once: the server is shared.
  onMount(async () => {
    await fleet.refresh();
    await budgets.refresh();
    await monthAll.refresh();
    await daily.refresh();
    await loadPace();
  });
  onDestroy(() => all.forEach((q) => q.stop()));

  let showAllInsights = $state(false);
  const nowDate = $derived(new Date(now.value));
  const staffError = $derived(
    fleet.error && (fleet.error.kind === "permission" || fleet.error.kind === "invalid" || fleet.error.kind === "tool")
      ? fleet.error.message
      : null,
  );

  // Budgets, enriched with a projection each.
  const budgetRows = $derived(
    (budgets.data?.budgets ?? []).map((b) => {
      const p = projectBurn(b.spend_this_month, b.amount, b.per_day_7d, nowDate);
      return { ...b, _p: p, _heat: heat(b.pct) };
    }),
  );
  const primaryProject = (b: BudgetRow) => b.projects?.[0] ?? b.name;

  // The account-level fee is not a project. It is its own KPI, never in the treemap,
  // the project table or any share. Skywalker's "(none)" row is the only source of it.
  const projectItems = $derived(monthAll.data?.items?.filter((i) => !isAccountLevel(i.project)) ?? []);
  const month = $derived(monthRow(pacificMonth(nowDate), monthAll.data));
  const fee = $derived(month.fee);
  // Usage gross and net come from the same full month call as the fee (not the truncated fleet list).
  const usageGross = $derived(month.usageGross);
  const usageNet = $derived(month.usageNet);
  const monthTruncated = $derived(monthAll.data?.truncated === true);
  const over = $derived(budgets.data?.summary?.over_100pct ?? null);
  const warn = $derived(budgets.data?.summary?.["75_to_100pct"] ?? null);

  // Month-end projection, labelled "gross, projection": the fee is charged once a month,
  // so it is added as-is and only usage is scaled by the day of month.
  const mp = $derived(monthProgress(nowDate));
  const projectedAll = $derived.by(() => {
    if (!isNum(usageGross) || !isNum(fee)) return null;
    return fee + (usageGross / mp.day) * mp.daysInMonth;
  });

  // PSSA coverage: all credit types against the fee (types are not split by Skywalker yet).
  const credits = $derived(month.credits);
  const pssaRatio = $derived(month.ratio);
  // Pace vs last month at the same day (item 6): the same rule as Billing (paceVsLast).
  const lastMonthKey = $derived(pacificMonth(new Date(now.value), 1));
  const pace = $derived.by(() => {
    const v = paceVsLast(lastDayCredits.cur, lastDayCredits.prev);
    return { value: v, label: isNum(v) ? `${signedPct(v)} vs ${lastMonthKey} at the same day` : "pace vs last month: --" };
  });
  const top = $derived(topShare(pssaProjectRows(monthAll.data)));

  // Rising first, then the biggest falls, so the chart shows both directions.
  const topMovers = $derived.by(() => {
    const rising = (fleet.data?.trend?.rising ?? []).slice(0, 4);
    const falling = (fleet.data?.trend?.falling ?? []).slice(0, 2).map((f) => ({ project_id: f.project_id, change_pct: f.change_pct, gross_last7: null, gross_prev7: null }));
    return [...rising, ...falling];
  });
  // One scale for all movers, so bar lengths compare across rows.
  const maxAbs = $derived(Math.max(1, ...topMovers.map((m) => Math.abs(m.change_pct ?? 0))));
  // Shared id prefix for the movers, so each row shows the short id and the full id is in a title.
  const moverPrefix = $derived(commonPrefix(topMovers.map((m) => m.project_id)));

  // Plain-language fleet insights, built only from the answers we have.
  const insights = $derived.by<Insight[]>(() => {
    const out: Insight[] = [];
    for (const b of budgetRows) {
      if (isNum(b.pct) && b.pct >= 100) {
        out.push({ level: "alert", area: "budget", text: `${primaryProject(b)} is at ${pct(b.pct)} of its ${money(b.amount)} budget (${money(b.spend_this_month)} so far${b.spend_basis === "net" ? ", net" : ""})${isNum(b._p.recentPerDay) ? `, burning ${money(b._p.recentPerDay)}/day (gross) over the last 7 days` : ""}` });
      } else if (isNum(b.pct) && b.pct >= 75) {
        out.push({ level: "warn", area: "budget", text: `${primaryProject(b)} is at ${pct(b.pct)} of budget${b._p.daysToExhaust !== null && b._p.daysToExhaust > 0 ? `; at the recent gross rate it runs out in ${days(b._p.daysToExhaust)}` : ""}` });
      }
      if (b.spend_basis === "net") {
        out.push({ level: "info", area: "budget basis", text: `${b.name} counts net (after credits), but lab policy is gross: ${money(b.spend_this_month)} net is compared with the budget` });
      }
    }
    for (const r of fleet.data?.trend?.rising ?? []) {
      if (r.change > 100 && (r.change_pct ?? 0) > 50) {
        out.push({ level: "warn", area: "spend", text: `${r.project_id} is speeding up: ${money(r.gross_last7)} gross in the last 7 days vs ${money(r.gross_prev7)} the week before (${signedPct(r.change_pct)})` });
      }
    }
    const acct = fleet.data?.trend?.account_level;
    if (acct && isNum(acct.gross_last7) && isNum(acct.gross_prev7) && acct.gross_prev7 > 0) {
      const chg = ((acct.gross_last7 - acct.gross_prev7) / acct.gross_prev7) * 100;
      out.push({ level: "info", area: "account", text: `Account-level charges ${chg >= 0 ? "up" : "down"} ${Math.abs(chg).toFixed(0)}% week over week (${money(acct.gross_last7)} vs ${money(acct.gross_prev7)}, gross)` });
    }
    if (isNum(credits) && isNum(fee) && fee > 0 && isNum(pssaRatio)) {
      out.push({ level: "info", area: "pssa", text: `${creditsText(credits)} credits (all types) so far this month = ${pct(pssaRatio * 100)} of ${money(fee)} account-level charges (gross)` });
    }
    if (top && top.count > 0 && pssaProjectRows(monthAll.data).length > 0) {
      out.push({ level: "info", area: "pssa", text: `${top.count} project${top.count === 1 ? "" : "s"} consume${top.count === 1 ? "s" : ""} 80% of credits (all types)` });
    }
    for (const u of fleet.data?.budgets?.unbudgeted ?? []) {
      if (u.gross_this_month >= 250) {
        out.push({ level: "warn", area: "budget", text: `${u.project_id} has spent ${money(u.gross_this_month)} (gross) this month with no budget` });
      }
    }
    const pub = fleet.data?.public_access ?? [];
    if (pub.length) out.push({ level: "alert", area: "security", text: `${int(pub.length)} resource${pub.length === 1 ? "" : "s"} grant public access (allUsers or allAuthenticatedUsers)` });
    const vms = fleet.data?.compute;
    if (vms && isNum(vms.running_vms)) out.push({ level: "info", area: "compute", text: `${int(vms.running_vms)} VMs running across ${int(vms.projects_with_running_vms)} projects` });
    for (const f of fleet.data?.findings ?? []) {
      if (!out.some((o) => o.text === f)) out.push({ level: "info", area: "fleet", text: f });
    }
    return out;
  });

  // The project a finding names, if any (a budget row or a rising project). Null otherwise.
  function heroProject(text: string): string | null {
    for (const b of budgetRows) {
      const p = primaryProject(b);
      if (text.startsWith(p)) return p;
    }
    for (const r of fleet.data?.trend?.rising ?? []) {
      if (text.startsWith(r.project_id)) return r.project_id;
    }
    return null;
  }

  // Item 14: the three most severe findings, as a one-line strip under the KPI row. Alert first, then warn.
  // A chip opens its project when the finding names one (budget and speeding-up findings do).
  const heroInsights = $derived.by(() => {
    const order: Record<string, number> = { alert: 0, warn: 1, info: 2 };
    const ranked = [...insights].sort((a, b) => (order[a.level] ?? 3) - (order[b.level] ?? 3));
    return ranked.slice(0, 3).map((i, n) => ({
      key: `${n}-${i.area}-${i.text.slice(0, 40)}`,
      level: i.level,
      text: i.text,
      pid: heroProject(i.text),
    }));
  });

  // One colour per project, used by the treemap, the bars and the table.
  const colourOf = (pid: string) => {
    const idx = projectItems.findIndex((i) => i.project === pid);
    return SERIES[(idx < 0 ? 0 : idx) % SERIES.length];
  };

  // Treemap: gross by project, fee excluded.
  const treemap = $derived(
    projectItems
      .filter((i) => i.project && i.gross > 0)
      .map((i) => ({ name: i.project as string, value: i.gross, itemStyle: { color: colourOf(i.project as string) } })),
  );
  const treeOption = $derived({
    tooltip: { formatter: (p: { name: string; value: number }) => `${p.name}<br/><b>${money(p.value)}</b> gross` },
    series: [{
      type: "treemap",
      roam: false,
      nodeClick: "link",
      breadcrumb: { show: false },
      left: 0, right: 0, top: 0, bottom: 0,
      // Labels only on tiles big enough to hold a name; the tooltip always has the full id.
      label: { show: true, formatter: (p: { name: string; value: number }) => `${shortId(p.name, idPrefix)}\n${money(p.value)}`, fontSize: 12, color: "#fff", overflow: "truncate", ellipsis: "…", minMargin: 6 },
      upperLabel: { show: false },
      itemStyle: { borderColor: "rgba(0,0,0,0.25)", borderWidth: 2, gapWidth: 2 },
      data: treemap,
    }],
  });

  // Daily gross as a step line: money is discrete, so no smoothing.
  const dailyOption = $derived.by(() => {
    const d = daily.data?.items ?? [];
    return {
      grid: { left: 52, right: 14, top: 14, bottom: 30 },
      tooltip: {
        trigger: "axis",
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0]?.dataIndex ?? 0;
          const x = d[i];
          if (!x) return "";
          return `${x.day}<br/><b>${money(x.gross)}</b>${i === d.length - 1 ? "<br/>partial day, still accruing" : ""}`;
        },
      },
      xAxis: { type: "category", data: d.map((x) => x.day.slice(5)), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: C.muted, fontSize: 11, hideOverlap: true } },
      yAxis: { type: "value", splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 11, formatter: (v: number) => moneyCompact(v) } },
      series: [{
        name: "Gross",
        type: "line",
        step: "end",
        symbol: "none",
        // The newest day is still accruing, so it is drawn apart (dashed, no fill), never as a real drop.
        data: d.map((x, i) => (i === d.length - 1 && d.length > 1 ? null : x.gross)),
        lineStyle: { width: 2.5, color: C.accent },
        areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(106,168,255,0.35)" }, { offset: 1, color: "rgba(106,168,255,0.0)" }] } },
      }, {
        name: "Newest day (partial)",
        type: "line",
        step: "end",
        symbol: "circle",
        symbolSize: 6,
        data: d.map((x, i) => (d.length > 1 && i >= d.length - 2 ? x.gross : null)),
        lineStyle: { width: 2, color: C.accent, type: "dashed", opacity: 0.7 },
        itemStyle: { color: C.accent, opacity: 0.6 },
      }],
    };
  });

  // Budget bars: the six highest. Linear, so overflow past 100% is shown, not clamped.
  const barBudgets = $derived([...budgetRows].filter((b) => isNum(b.pct)).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0)).slice(0, 6));
  // One shared scale for the bars: 100%, or the largest value if higher.
  // Same shared rule as the Budgets page (review item 7): max(100, pcts) * 1.05, so overflow stays inside the track.
  const barScale = $derived(Math.max(100, ...barBudgets.map((b) => b.pct ?? 0)) * 1.05);

  const projectTable = $derived(projectItems.map((i) => {
    const pid = i.project ?? "";
    const rise = fleet.data?.trend?.rising?.find((r) => r.project_id === pid);
    return { pid, gross: i.gross, net: i.net, change_pct: rise?.change_pct ?? null, last7: rise?.gross_last7 ?? null };
  }));
  const usageSum = $derived(projectTable.reduce((s, r) => s + r.gross, 0));

  const idPrefix = $derived(commonPrefix([...projectItems.map((i) => i.project ?? ""), ...budgetRows.map((b) => primaryProject(b))].filter(Boolean)));
  function openProject(pid: string) {
    router.go(projectPath(pid, "spend"));
  }
</script>

<div class="page-head">
  <span class="tiny faint">All figures gross unless marked net · credits (all types) are negative · updated {oldestAgo}</span>
</div>
{#if heroInsights.length}
  <div class="hero-strip" role="group" aria-label="Most severe findings">
    {#each heroInsights as h (h.key)}
      <button class="hero-chip {h.level}" onclick={() => h.pid && openProject(h.pid)} disabled={!h.pid} title={h.text}>
        <span class="hero-dot" aria-hidden="true"></span>
        <span class="hero-text">{h.text}</span>
      </button>
    {/each}
  </div>
{/if}
<div class="grid g3" style="margin-bottom:14px">
  <div class="card">
    <div class="kpi-label">Usage MTD</div>
    {#if monthAll.loading && !monthAll.data}<div class="skeleton" style="width:60%;margin-top:8px;height:28px"></div>{:else}
      <div class="hero num">{money(usageGross)}</div>
      <div class="kpi-sub">{monthAll.data?.window?.label ?? "this month"} · gross: list price, before credits</div>
      {#if monthTruncated}<div class="kpi-sub">{projectItems.length} projects shown; Skywalker capped the list, so the total is withheld</div>{/if}
    {/if}
  </div>
  <div class="card">
    <div class="kpi-label">Usage MTD, net (after credits)</div>
    <div class="hero num">{money(usageNet)}</div>
    <div class="kpi-sub">{netLine(usageGross, month.usageCredits)}</div>
  </div>
  <div class="card">
    <div class="kpi-label">PSSA coverage (credits / account-level charges)</div>
    <div class="hero num">{isNum(pssaRatio) ? `${(pssaRatio * 100).toFixed(0)}%` : DASH}</div>
    <Bullet value={isNum(pssaRatio) ? pssaRatio * 100 : null} scaleMax={isNum(pssaRatio) ? Math.max(100, pssaRatio * 100 * 1.1) : 100} label="credits (all types) as a share of account-level charges; 100% tick marked" />
    <div class="kpi-sub">{pace.label}</div>
  </div>
  <div class="card">
    <div class="kpi-label">Account-level charges</div>
    <div class="hero num">{money(fee)}</div>
    <div class="kpi-sub">subscription fee + support, no project (not split)</div>
  </div>
  <div class="card">
    <div class="kpi-label">Net incl. account-level</div>
    <div class="hero num">{money(month.net)}</div>
    <div class="kpi-sub">{netLine(isNum(fee) && isNum(usageGross) ? fee + usageGross : null, credits)}</div>
  </div>
  <div class="card">
    <div class="kpi-label">Projected month end</div>
    <div class="hero num">{money(projectedAll)}</div>
    <div class="kpi-sub">projection: fee + usage at the month-to-date daily average</div>
  </div>
</div>

{#if staffError}
  <div class="notice warn" style="margin-bottom:14px">
    <span>Fleet views need Skywalker staff access on your Google account. {staffError}</span>
  </div>
{/if}

<div class="grid g2" style="grid-template-columns: 1.25fr 1fr; align-items: start;">
  <Section title="What to look at" sub={insights.length > 6 ? `computed from Skywalker · ${insights.length} findings` : "computed from Skywalker"} loading={fleet.loading && !fleet.data} error={staffError ? null : fleet.error} empty={!fleet.data && !fleet.error} emptyText="Loading the fleet…" ago="">
    <Insights items={showAllInsights ? insights : insights.slice(0, 6)} limit={99} />
    {#if insights.length > 6}
      <button class="btn small" style="margin-top:10px" onclick={() => (showAllInsights = !showAllInsights)}>{showAllInsights ? "Show fewer" : `Show all (${insights.length})`}</button>
    {/if}
  </Section>

  <div class="stack">
  <Section title="Top movers" sub="gross, last 7 days vs the 7 before" loading={fleet.loading && !fleet.data} error={null} empty={topMovers.length === 0} emptyText="No project spend changes to show." ago="">
    <div class="movers">
      {#each topMovers as m (m.project_id)}
        {@const v = m.change_pct ?? 0}
        <button class="mover" onclick={() => openProject(m.project_id)} title={m.project_id}>
          <span class="mono mover-name" title={m.project_id}>{shortId(m.project_id, moverPrefix)}</span>
          <span class="mover-track"><span class="zero"></span>
            <span style="position:absolute;top:0;bottom:0;{v >= 0 ? 'left:50%' : 'right:50%'};width:{Math.min(50, (Math.abs(v) / maxAbs) * 50)}%;background:{v >= 0 ? C.warn : C.good}"></span></span>
          <span class="num mover-val" style="color:{v > 50 ? C.warn : 'inherit'}">{signedPct(m.change_pct)}</span>
        </button>
      {/each}
    </div>
  </Section>

  <Section title="Budgets" sub={`% of budget used; ${int(over)} over 100%, ${int(warn)} at 75 to 100%`} loading={budgets.loading && !budgets.data} error={budgets.error} empty={!budgets.data || barBudgets.length === 0} emptyText="No budgets with a reported amount." ago="">
    <div class="bars">
      {#each barBudgets as b (b.id)}
        <button class="bar-row" onclick={() => openProject(primaryProject(b))} title="Open {primaryProject(b)}">
          <span class="mono bar-name" title={primaryProject(b)}>{shortId(primaryProject(b), idPrefix)}</span>
          <Bullet value={b.pct} scaleMax={barScale} fill={heatColor(b.pct)} />
          <span class="num bar-val" style="color:{heatColor(b.pct)}">{pct(b.pct)}</span>
          <span class="tiny faint bar-sub">{money(b.spend_this_month)} of {money(b.amount)}{b.spend_basis === "net" ? " · net" : ""}</span>
        </button>
      {/each}
    </div>
  </Section>
  </div>
</div>

<div class="grid" style="margin-top:14px">
  <Section title="Daily gross, all projects" sub="last 30 days · dashed = newest day, still accruing" loading={daily.loading && !daily.data} error={daily.error} empty={!(daily.data?.items?.length)} emptyText="No daily spend in the window." ago="">
    <Chart option={dailyOption} height="260px" label="Daily spend chart" />
  </Section>
</div>

<div class="grid" style="margin-top:14px">
  <Section title="Spend by project" sub="treemap, month to date (gross; the fee is not a project)" loading={fleet.loading && !fleet.data} error={fleet.error} empty={treemap.length === 0} emptyText="No project spend in this window." ago="">
    <Chart option={treeOption} height="320px" label="Spend by project treemap" />
  </Section>
</div>

<div class="grid" style="margin-top:14px">
  <Section title="Projects" sub={`click a row to open it; the fee is not a project; names shortened, hover for the full id`} loading={fleet.loading && !fleet.data} error={fleet.error} empty={projectTable.length === 0} emptyText="No projects with spend this month." ago="">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th class="r">Usage MTD, gross</th>
            <th class="r">Net (after credits)</th>
            <th class="r">Last 7 days, gross</th>
            <th class="r">vs week before</th>
            <th>Share of usage (gross)</th>
          </tr>
        </thead>
        <tbody>
          {#each projectTable as r (r.pid)}
            {@const share = usageSum > 0 ? (r.gross / usageSum) * 100 : null}
            <tr class="click" onclick={() => openProject(r.pid)}>
              <td class="mono" title={r.pid}>{shortId(r.pid, idPrefix)}</td>
              <td class="r num">{money(r.gross)}</td>
              <td class="r num">{money(r.net)}</td>
              <td class="r num">{money(r.last7)}</td>
              <td class="r num" style="color:{isNum(r.change_pct) && r.change_pct > 50 ? C.warn : 'inherit'}">{signedPct(r.change_pct)}</td>
              <td style="min-width:120px"><Meter value={share} max={100} color={colourOf(r.pid)} /></td>
            </tr>
          {:else}
            <tr><td colspan="6" class="faint">--</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </Section>
</div>

<style>
  .page-head { display: flex; justify-content: flex-end; margin: -6px 0 6px; }
  .hero-strip { display: flex; gap: 8px; flex-wrap: wrap; align-items: stretch; margin: 0 0 14px; }
  .hero-strip::-webkit-scrollbar { display: none; }
  .hero-chip { display: inline-flex; align-items: center; gap: 8px; flex: 1 1 280px; min-width: 0; max-width: 100%; padding: 8px 12px; line-height: 1.35; border-radius: 10px; border: 1px solid var(--stroke); background: var(--surface-2); color: inherit; font-size: 12.5px; text-align: left; }
  .hero-chip:not(:disabled):hover { border-color: var(--text-3); }
  .hero-chip:disabled { cursor: default; }
  .hero-chip.alert { border-color: rgba(255, 85, 119, 0.35); background: rgba(255, 85, 119, 0.08); }
  .hero-chip.alert .hero-dot { background: var(--alert, #ff5577); }
  .hero-chip.warn { border-color: rgba(245, 181, 68, 0.35); background: rgba(245, 181, 68, 0.08); }
  .hero-chip.warn .hero-dot { background: #f5b544; }
  .hero-chip.info .hero-dot { background: #6aa8ff; }
  .hero-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .hero-text { display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; min-width: 0; }
  .movers { display: grid; gap: 8px; }
  .mover { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(80px, 1.2fr) 64px; gap: 10px; align-items: center; background: transparent; border: 0; padding: 5px 6px; border-radius: 9px; color: inherit; text-align: left; }
  .mover:hover { background: var(--surface-2); }
  .mover-name { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mover-track { position: relative; height: 6px; border-radius: 3px; background: var(--surface-2); display: block; }
  .mover-track > span:not(.zero) { border-radius: 3px; }
  .zero { position: absolute; left: 50%; top: -2px; bottom: -2px; width: 1px; background: var(--text-3); }
  .mover-val { text-align: right; font-weight: 600; font-size: 12.5px; }
  .stack { display: grid; gap: 14px; align-content: start; }
  .bars { display: grid; gap: 8px; }
  .bar-row { display: grid; grid-template-columns: minmax(110px, 1fr) minmax(140px, 2fr) 60px; gap: 6px 10px; align-items: center; background: transparent; border: 0; padding: 5px 6px; border-radius: 9px; color: inherit; text-align: left; }
  .bar-row:hover { background: var(--surface-2); }
  .bar-name { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-val { text-align: right; font-weight: 600; }
  .bar-sub { grid-column: 2 / 4; }
</style>
