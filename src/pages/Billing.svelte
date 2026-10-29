<script lang="ts">
  // Billing & PSSA: account-level charges (subscription fee + support), usage and credits, by month and by project.
  // Source: skywalker_spend_all (staff) from the Cloud Billing export. Every money figure
  // says gross or net. Credit types are NOT split: Skywalker has no credits tool yet, so
  // that card says so instead of estimating a split.
  import { onDestroy, onMount } from "svelte";
  import Chart from "../components/Chart.svelte";
  import Section from "../components/Section.svelte";
  import Insights from "../components/Insights.svelte";
  import Bullet from "../components/Bullet.svelte";
  import Table from "../components/Table.svelte";
  import { callOnce } from "../lib/query.svelte";
  import { money, moneyCompact, moneyG, pct, signedPct, DASH, isNum, ago, creditsText, netLine } from "../lib/format";
  import { C } from "../lib/palette";
  import { monthRow, paceVsLast, projectRows, projectBars, recentMonths, topShare, pssaInsights, shortId, usageBar, type SpendAll } from "../lib/pssa";
  import { commonPrefix } from "../lib/format";
  import { now } from "../lib/clock.svelte";
  import { loadCatalog, hasTool } from "../lib/catalog";
  import { asAppError, describeError, type AppError } from "../lib/api";
  import type { Insight } from "../lib/insights";

  let fetchedMs = $state<number | null>(null);
  const lastUpdated = $derived(fetchedMs ? ago(fetchedMs, now.value) : "--");
  const CLOSED_MAX_AGE_SECS = 21_600; // closed months change rarely: 6 hours is fine.
  const CURRENT_MAX_AGE_SECS = 300;

  let months = $state<string[]>([]);
  let monthly = $state<Record<string, SpendAll | null>>({});
  let loadErr = $state<AppError | null>(null);
  let loading = $state(false);
  let lastDay = $state<Record<string, number | null>>({});
  let busy = $state(false);
  let catalogReady = $state(false);
  // "fee" = account-level bar beside usage; "usage" hides that bar and the net line (review item 16).
  let view = $state<"fee" | "usage">("fee");
  // Credit types split by skywalker_credits. Shown only when the server has the tool.
  // DEMO has no skywalker_credits fixture, so DEMO shows the "needs a Skywalker update" note
  // (the old `__DEMO__ ||` showed a raw card stuck on "Loading…" forever: qa/40-opus-billing.png).
  const hasCreditTypes = $derived(catalogReady && !__DEMO__ && hasTool("skywalker_credits"));

  const currentMonth = $derived(months[months.length - 1] ?? "");
  const prevMonth = $derived(months[months.length - 2] ?? "");
  const nowDate = $derived(new Date(now.value));
  const today = $derived(pacificDay(nowDate));

  function pacificDay(d: Date): number {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", day: "2-digit" }).formatToParts(d);
    return Number(parts.find((p) => p.type === "day")?.value ?? 1);
  }

  /** One month at a time, never in parallel. Stops if the page is left. */
  async function loadMonths(force = false) {
    if (busy) return;
    busy = true;
    loading = true;
    loadErr = null;
    const list = recentMonths(new Date(now.value), 7);
    months = list;
    const next: Record<string, SpendAll | null> = { ...monthly };
    try {
      for (const m of list) {
        const isCurrent = m === list[list.length - 1];
        const age = isCurrent ? CURRENT_MAX_AGE_SECS : CLOSED_MAX_AGE_SECS;
        try {
          const r = await callOnce<SpendAll>("skywalker_spend_all", { group_by: "project", month: m, limit: 500 }, force && isCurrent ? 0 : age);
          next[m] = r.data;
          fetchedMs = r.fetched_at_ms;
        } catch (e) {
          next[m] = null;
          loadErr = asAppError(e);
          if (loadErr.kind === "rate_limited") break;
        }
        monthly = { ...next };
      }
      monthly = next;
    } finally {
      loading = false;
      busy = false;
    }
  }

  /** Month-to-date pace: credits so far this month vs last month at the same day. */
  async function loadPace() {
    if (!currentMonth || !prevMonth) return;
    const out: Record<string, number | null> = {};
    try {
      const r = await callOnce<{ items: { day: string; credits: number }[] }>("skywalker_spend_all", { group_by: "day", month: prevMonth, limit: 60 }, CLOSED_MAX_AGE_SECS);
      const sameDay = (r.data.items ?? []).filter((x) => Number(x.day.slice(8, 10)) <= today).reduce((s, x) => s + x.credits, 0);
      out[prevMonth] = sameDay;
    } catch {
      out[prevMonth] = null;
    }
    try {
      const r = await callOnce<{ items: { day: string; credits: number }[] }>("skywalker_spend_all", { group_by: "day", month: currentMonth, limit: 60 }, CURRENT_MAX_AGE_SECS);
      out[currentMonth] = (r.data.items ?? []).reduce((s, x) => s + x.credits, 0);
    } catch {
      out[currentMonth] = null;
    }
    lastDay = out;
  }

  onMount(async () => {
    // The tool catalogue decides whether the credit-type card can show a split.
    await loadCatalog();
    catalogReady = true;
    // Demo and release both load the months first, then the month-to-date pace.
    await loadMonths();
    await loadPace();
  });
  onDestroy(() => {
    /* nothing running in the background: calls are one-shot. */
  });

  // The seven months, monthRow each. A derived value (not an effect) so the chart always
  // gets the full series on every update.
  const rows = $derived(months.map((m) => monthRow(m, monthly[m] ?? null)));
  // Charts draw only once every month has answered; a half-filled plot looked broken.
  const settled = $derived(loading ? [] : rows);

  const cur = $derived(rows.find((r) => r.month === currentMonth) ?? null);
  const last = $derived(rows.find((r) => r.month === prevMonth) ?? null);
  const curSpend = $derived(currentMonth ? monthly[currentMonth] ?? null : null);
  const curProjects = $derived(projectRows(curSpend));
  const curTop = $derived(topShare(curProjects));
  const pace = $derived(paceVsLast(lastDay[currentMonth] ?? null, lastDay[prevMonth] ?? null));

  // Credit types, only when Skywalker offers skywalker_credits. The shape is not known yet,
  // so the answer is shown raw, never split by us.
  let creditTypesRaw = $state<unknown>(null);
  let creditTypesErr = $state<AppError | null>(null);
  $effect(() => {
    if (!catalogReady || __DEMO__ || !hasTool("skywalker_credits") || !currentMonth) return;
    void callOnce("skywalker_credits", { month: currentMonth }, CURRENT_MAX_AGE_SECS)
      .then((r) => { creditTypesRaw = r.data; creditTypesErr = null; })
      .catch((e) => { creditTypesRaw = null; creditTypesErr = asAppError(e); });
  });

  // Item 3: the day rows and the month row come from two calls. If they disagree by more
  // than 1%, say so and show both; never pick one silently.
  let dayCredits = $state<number | null>(null);
  $effect(() => {
    if (!currentMonth) return;
    void callOnce<{ items: { credits: number }[] }>("skywalker_spend_all", { group_by: "day", month: currentMonth, limit: 60 }, CURRENT_MAX_AGE_SECS)
      .then((r) => { dayCredits = (r.data.items ?? []).reduce((s, x) => s + x.credits, 0); })
      .catch(() => { dayCredits = null; });
  });
  const creditsMismatch = $derived(
    isNum(cur?.credits) && isNum(dayCredits) && Math.abs(dayCredits - (cur?.credits ?? 0)) > Math.abs(cur?.credits ?? 0) * 0.01,
  );

  // Account-level charges, last 7 days vs the previous 7 (gross), from the trend tool.
  let trend = $state<{ gross_last7: number; gross_prev7: number } | null>(null);
  $effect(() => {
    if (__DEMO__) return;
    void callOnce<{ account_level?: { gross_last7: number; gross_prev7: number } }>("skywalker_spend_trend", { top_n: 5 }, 600)
      .then((r) => (trend = r.data.account_level ?? null))
      .catch(() => (trend = null));
  });

  const chartMonths = $derived(settled.map((r) => r.month.slice(2)));
  const barOption = $derived({
    grid: { left: 60, right: 16, top: 40, bottom: 30 },
    legend: { top: 0, textStyle: { color: C.muted, fontSize: 11 }, icon: "roundRect", itemWidth: 10, itemHeight: 10 },
    // Tooltip shows the signed net too (review item 4): the stack alone cannot show a negative net.
    tooltip: {
      trigger: "axis",
      formatter: (ps: { axisValue: string; dataIndex: number }[]) => {
        const r = settled[ps[0]?.dataIndex ?? 0];
        if (!r) return "";
        const b = usageBar(r.usageGross, r.usageCredits);
        const lines = [`<b>${r.month}</b>`];
        if (isNum(r.fee) && view === "fee") lines.push(`Account-level charges: ${money(r.fee)} gross`);
        if (isNum(r.usageGross)) lines.push(`Usage gross: ${money(r.usageGross)}`);
        if (isNum(r.usageCredits)) lines.push(`Credits (all types): ${creditsText(r.usageCredits)}`);
        if (isNum(r.usageNet)) lines.push(`Usage net: ${money(r.usageNet)}${b.over ? " (credits exceed usage)" : ""}`);
        if (isNum(r.net)) lines.push(`Net incl. account-level: ${money(r.net)}`);
        return lines.join("<br/>");
      },
    },
    xAxis: { type: "category", data: chartMonths, axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: C.muted, fontSize: 11 } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 11, formatter: (v: number) => moneyCompact(v) } },
    // Usage is ONE stacked bar: net (after credits) + credits consumed = gross usage. A month where
    // credits exceed usage is one gross bar with a marker. In "usage only" the fee bar and the net line are hidden.
    series: [
      ...(view === "fee" ? [{ name: "Account-level charges, gross", type: "bar", barMaxWidth: 22, itemStyle: { color: "#7d8698", borderRadius: [4, 4, 0, 0] }, data: settled.map((r) => r.fee ?? null) }] : []),
      {
        name: "Usage net",
        type: "bar",
        stack: "use",
        barMaxWidth: 22,
        itemStyle: { color: C.warn },
        data: settled.map((r) => usageBar(r.usageGross, r.usageCredits).net),
        markPoint: {
          symbol: "pin",
          symbolSize: 34,
          label: { formatter: "credits\nexceed usage", fontSize: 9, color: "#fff" },
          data: settled.flatMap((r, i) => (usageBar(r.usageGross, r.usageCredits).over && isNum(r.usageGross) ? [{ coord: [i, r.usageGross], itemStyle: { color: C.alert } }] : [])),
        },
      },
      { name: "Credits consumed, all types", type: "bar", stack: "use", barMaxWidth: 22, itemStyle: { color: C.good, borderRadius: [4, 4, 0, 0] }, data: settled.map((r) => usageBar(r.usageGross, r.usageCredits).consumed) },
      ...(view === "fee" ? [{ name: "Net incl. account-level charges", type: "line", step: "end", symbol: "circle", symbolSize: 6, lineStyle: { width: 2, color: C.accent2 }, itemStyle: { color: C.accent2 }, data: settled.map((r) => r.net ?? null) }] : []),
    ],
  });

  // The id prefix shared by every project this month; stated once in the section sub.
  const idPrefix = $derived(commonPrefix(curProjects.map((r) => r.project)));
  const projectOption = $derived.by(() => {
    const top = curProjects.slice(0, 12);
    // Bottom-up for a horizontal bar chart: reverse once, for names and series alike.
    const bars = projectBars(top).reverse();
    return {
      grid: { left: 8, right: 56, top: 30, bottom: 4, containLabel: true },
      legend: { top: 0, textStyle: { color: C.muted, fontSize: 11 }, icon: "roundRect", itemWidth: 10, itemHeight: 10 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => money(v) },
      xAxis: { type: "value", splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 11, formatter: (v: number) => moneyCompact(v) } },
      yAxis: { type: "category", data: top.map((r) => shortId(r.project, idPrefix)).reverse(), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: C.muted, fontSize: 11, width: 160, overflow: "truncate" } },
      // One bar per project: net + credits consumed on one stack, so the bar length is gross.
      series: [
        // Item 3: both series come from projectBars (pssa.ts, tested), so no value is negative.
        // Credits > usage: one gross bar in the alert colour; the signed net is in the tooltip.
        { name: "Net (after credits)", type: "bar", stack: "p", barMaxWidth: 16, itemStyle: { color: C.warn }, data: bars.map((b) => b.net) },
        { name: "Credits consumed, all types", type: "bar", stack: "p", barMaxWidth: 16, itemStyle: { color: C.good }, data: bars.map((b) => b.consumed) },
        // Credits exceed usage: usage is fully covered (all green) and the surplus is drawn left of zero.
        ...(bars.some((b) => b.over) ? [{ name: "Net below zero (credits exceed usage)", type: "bar", stack: "neg", barMaxWidth: 16, itemStyle: { color: C.alert }, data: bars.map((b) => (b.over ? b.below : null)) }] : []),
      ],
    };
  });

  // Insights, from these numbers only. The PSSA sentences come from pssa.ts (tested).
  const insights = $derived.by<Insight[]>(() => {
    const out: Insight[] = [];
    if (cur && isNum(cur.credits) && isNum(cur.fee) && cur.fee > 0 && isNum(cur.ratio)) {
      const soFar = `${creditsText(cur.credits)} credits (all types) so far in ${currentMonth} = ${pct(cur.ratio * 100)} of the ${money(cur.fee)} account-level charges`;
      const pacing = isNum(pace) ? `; credits to date are ${signedPct(pace)} vs ${prevMonth} at the same day (all types)` : "";
      out.push({ level: "info", area: "pssa", text: soFar + pacing });
    }
    const dim = (() => {
      const [y, m] = currentMonth.split("-").map(Number);
      return y && m ? new Date(Date.UTC(y, m, 0)).getUTCDate() : 30;
    })();
    for (const t of pssaInsights(cur, curProjects, today, dim)) out.push({ level: "info", area: "pssa", text: t });
    if (curTop && curTop.count > 0 && curProjects.length > 3) {
      out.push({ level: "info", area: "pssa", text: `${curTop.count} project${curTop.count === 1 ? "" : "s"} consume${curTop.count === 1 ? "s" : ""} 80% of credits (all types) in ${currentMonth}` });
    }
    if (trend && isNum(trend.gross_last7) && isNum(trend.gross_prev7) && trend.gross_prev7 > 0) {
      const chg = ((trend.gross_last7 - trend.gross_prev7) / trend.gross_prev7) * 100;
      out.push({ level: "info", area: "account", text: `Account-level charges ${chg >= 0 ? "up" : "down"} ${Math.abs(chg).toFixed(0)}% week over week (${moneyG(trend.gross_last7)} vs ${moneyG(trend.gross_prev7)})` });
    }
    if (last && isNum(last.fee) && isNum(last.credits) && isNum(last.ratio)) {
      out.push({ level: "info", area: "pssa", text: `${prevMonth} closed with ${creditsText(last.credits)} credits (all types) against ${money(last.fee)} of account-level charges (${pct(last.ratio * 100)})` });
    }
    return out;
  });

  const fleetWarn = $derived(curSpend?.truncated === true);
  // Plain objects for the shared Table (its generic needs a Record, not an interface).
  const monthTable = $derived(
    [...rows].reverse().map((r) => ({
      month: r.month,
      fee: r.fee,
      usage: r.usageGross,
      credits: r.credits,
      net: r.net,
      ratio: r.ratio,
    })),
  );
</script>

<div class="head">
  <div>
    <div class="caps">Ursa Major</div>
    <h1>Billing & PSSA</h1>
    <div class="meta">
      Account-level charges, usage and credits from the Cloud Billing export, through Skywalker. All figures are gross unless marked net. Credits are negative; net = gross + credits.
    </div>
  </div>
  <span class="spacer"></span>
  <span class="tiny faint">updated {lastUpdated}</span>
  <button class="btn small" onclick={() => loadMonths(true)} disabled={busy}>{busy ? "Loading months…" : "Refresh"}</button>
</div>

{#if loadErr}
  <div class="notice error" role="alert" style="margin-top:14px">{describeError(loadErr)}</div>
{/if}

<div class="grid g4" style="margin:14px 0">
  <div class="card">
    <div class="kpi-label">Account-level charges, {currentMonth || "this month"}</div>
    <div class="hero num">{money(cur?.fee)}</div>
    <div class="kpi-sub">subscription fee + support (no project)</div>
  </div>
  <div class="card">
    <div class="kpi-label">Usage</div>
    <div class="hero num">{money(cur?.usageGross)}</div>
    <div class="kpi-sub">project usage at list price, before credits</div>
  </div>
  <div class="card">
    <div class="kpi-label">Credits, all types</div>
    <div class="hero num">{creditsText(cur?.credits)}</div>
    <div class="kpi-sub">subscription benefit and other discounts, not split yet</div>
  </div>
  <div class="card">
    <div class="kpi-label">Net incl. account-level</div>
    <div class="hero num">{money(cur?.net)}</div>
    <div class="kpi-sub">{cur && isNum(cur.fee) && isNum(cur.usageGross) ? netLine(cur.fee + cur.usageGross, cur.credits) : DASH}</div>
    <div class="kpi-sub">account-level charges are charged in full; credits reduce usage only</div>
  </div>
</div>

<div class="grid g2" style="grid-template-columns: 1.4fr 1fr; align-items:start">
  <Section title="Fee, usage and credits by month" sub="last 7 months (Pacific billing months)" loading={loading || !rows.length} error={loadErr && !rows.length ? loadErr : null} empty={!rows.length} emptyText="Loading months…" ago="">
    {#snippet actions()}
      <div class="seg" role="group" aria-label="Chart view">
        <button class:on={view === "fee"} onclick={() => (view = "fee")}>Account-level vs usage</button>
        <button class:on={view === "usage"} onclick={() => (view = "usage")}>Usage only</button>
      </div>
    {/snippet}
    {#if !loading}
      <Chart option={barOption} height="340px" label="Account-level charges, usage and credits by month" />
    {/if}
    <div class="tiny faint" style="margin-top:8px">Closed months are cached for six hours. Credits are all types combined (the split needs a Skywalker update).</div>
  </Section>

  <Section title="Credits against account-level charges" sub="benefit / fee: all credit types, this month" loading={loading && !cur} error={null} empty={!cur} emptyText="--" ago="">
    <div class="ratio">
      <div class="kpi-label">Credits / account-level charges, {currentMonth}</div>
      <div class="hero num">{isNum(cur?.ratio) ? `${(cur?.ratio ?? 0).toFixed(2)}×` : DASH}</div>
      <Bullet value={isNum(cur?.ratio) ? (cur?.ratio ?? 0) * 100 : null} scaleMax={isNum(cur?.ratio) ? Math.max(100, (cur?.ratio ?? 0) * 100 * 1.1) : 100} label="share of the account-level charges covered by all credit types" />
      <div class="pace-grid">
        <div>
          <div class="kpi-label">Credits so far, {currentMonth}</div>
          <div class="num">{creditsText(lastDay[currentMonth])}</div>
          <div class="tiny faint">all credit types, month to date</div>
        </div>
        <div>
          <div class="kpi-label">Same day, {prevMonth}</div>
          <div class="num">{creditsText(lastDay[prevMonth])}</div>
          <div class="tiny faint">pace: {isNum(pace) ? signedPct(pace) : "--"}</div>
        </div>
      </div>
    </div>
    {#if creditsMismatch}
      <div class="cardnote">
        <b>Day totals differ from the month total (export still filling in).</b>
        Month total: {creditsText(cur?.credits)} credits (all types). Sum of days: {creditsText(dayCredits)} credits (all types). Neither is picked.
      </div>
    {/if}
    {#if hasCreditTypes}
      <div class="cardnote">
        <b>Credits by type (raw).</b>
        {#if creditTypesErr}<span>{describeError(creditTypesErr)}</span>{:else if creditTypesRaw === null}<span>Loading…</span>{:else}<pre class="json">{JSON.stringify(creditTypesRaw, null, 2)}</pre>{/if}
      </div>
    {:else if catalogReady}
      <div class="cardnote">
        <b>Credit-type breakdown needs a Skywalker update.</b> The server does not offer skywalker_credits yet, so the split between SUBSCRIPTION_BENEFIT and other discounts is not shown. Every credit figure here is all types combined, labelled so. Nothing is estimated.
      </div>
    {/if}
  </Section>
</div>

<div class="grid g2" style="margin-top:14px">
  <Section title="Per project, {currentMonth}" sub={`bar = gross usage, split into net and credits (all types); names shortened, hover for the full id`} loading={loading && !curSpend} error={null} empty={!curProjects.length} emptyText="No project rows this month." ago="">
    <Chart option={projectOption} height={`${Math.max(180, curProjects.length * 28 + 60)}px`} label="Per project gross, credits and net" />
    {#if fleetWarn}<div class="tiny faint" style="margin-top:6px">Skywalker truncated this list at its limit; project figures may be incomplete.</div>{/if}
  </Section>

  <Section title="Top consumers of credits" sub={`all types, ${currentMonth}`} loading={loading && !curSpend} error={null} empty={!curProjects.length} emptyText="--" ago="">
    <div class="top-list">
      <div class="top-row top-head">
        <span></span><span class="tiny faint">Project</span><span class="tiny faint r">Credits</span><span class="tiny faint r">Gross usage</span>
      </div>
      {#each curProjects.slice(0, 8) as r, i (r.project)}
        <div class="top-row">
          <span class="rank">{i + 1}</span>
          <span class="mono top-name" title={r.project}>{shortId(r.project, idPrefix)}</span>
          <span class="num r" title="credits, all types">{creditsText(r.credits)}</span>
          <span class="num r faint" title="usage at list price">{money(r.gross)}</span>
        </div>
      {:else}
        <div class="empty">--</div>
      {/each}
    </div>
    {#if curTop && curTop.count > 0}
      <div class="tiny faint" style="margin-top:10px">{curTop.count} project{curTop.count === 1 ? "" : "s"} reach 80% of credits (all types).</div>
    {/if}
  </Section>
</div>

<div class="grid" style="margin-top:14px">
  <Section title="Monthly table" sub="all figures gross unless marked net; usage excludes account-level charges" loading={loading && !rows.length} error={null} empty={!rows.length} emptyText="Loading months…" ago="">
    <Table rows={monthTable} rowKey={(r) => r.month} cols={[
      { key: "m", label: "Month", value: (r) => r.month },
      { key: "fee", label: "Account-level", value: (r) => r.fee, fmt: (r) => money(r.fee), align: "r" },
      { key: "use", label: "Usage", value: (r) => r.usage, fmt: (r) => money(r.usage), align: "r" },
      { key: "cred", label: "Credits (all types)", value: (r) => r.credits, fmt: (r) => creditsText(r.credits), align: "r" },
      { key: "net", label: "Net incl. account-level", value: (r) => r.net, fmt: (r) => money(r.net), align: "r" },
      { key: "ratio", label: "Credits / account-level", value: (r) => r.ratio, fmt: (r) => (isNum(r.ratio) ? `${r.ratio.toFixed(2)}×` : DASH), align: "r" },
    ]} />
    <div class="tiny faint" style="margin-top:10px">Account-level charges are Skywalker's “(none)” row: subscription fee plus support, gross, no project. Skywalker does not split that row, and nothing here estimates the split. Usage gross = the month's gross minus that row.</div>
  </Section>
</div>

{#if insights.length}
  <div class="grid" style="margin-top:14px">
    <Section title="What the numbers say" sub="computed only from Skywalker figures">
      <Insights items={insights} limit={10} />
    </Section>
  </div>
{/if}

<style>
  .head { display: flex; align-items: flex-start; gap: 14px; flex-wrap: wrap; }
  h1 { margin: 4px 0 6px; font-size: 22px; letter-spacing: -0.01em; font-weight: 650; }
  .meta { color: var(--text-2); font-size: 13px; max-width: 70ch; }
  .ratio { display: grid; gap: 12px; }
  .pace-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .cardnote { margin-top: 14px; padding: 10px 12px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--stroke); font-size: 12.5px; color: var(--text-2); }
  .top-list { display: grid; gap: 6px; }
  .top-head { border-bottom: 1px solid var(--stroke); padding-bottom: 4px; }
  .r { text-align: right; }
  .top-row { display: grid; grid-template-columns: 22px minmax(140px, 1fr) auto auto; gap: 10px; align-items: baseline; padding: 6px 4px; border-bottom: 1px solid var(--stroke); }
  .rank { color: var(--text-3); font-size: 12px; }
  .top-name { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
