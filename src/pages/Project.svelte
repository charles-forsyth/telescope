<script lang="ts">
  import { onDestroy } from "svelte";
  function oldestAge(r: { user_managed_keys?: { age_days: number | null }[] }): number | null {
    const ages = (r.user_managed_keys ?? []).map((k) => k.age_days).filter((a): a is number => typeof a === "number");
    return ages.length ? Math.max(...ages) : null;
  }
  import Chart from "../components/Chart.svelte";
  import Section from "../components/Section.svelte";
  import Insights from "../components/Insights.svelte";
  import Meter from "../components/Meter.svelte";
  import Table from "../components/Table.svelte";
  import { query } from "../lib/query.svelte";
  import { money, moneyCompact, moneyG, moneyN, int, gb, pct, shortTime, shortDate, shortResource, DASH, isNum, creditsText } from "../lib/format";
  import { C, SERIES, heatColor } from "../lib/palette";
  import { projectInsights, computeSentence, project as burn, type OverviewData, type Insight } from "../lib/insights";
  import { recentMonths } from "../lib/pssa";
  import { projectPath, router } from "../lib/router.svelte";
  import { now } from "../lib/clock.svelte";

  interface Props { id: string; tab: string; }
  let { id, tab }: Props = $props();


  // Tabs grouped for the header: a flat row of 12 was too crowded. Every tab stays reachable.
  const TAB_GROUPS: { label: string; tabs: { id: string; label: string }[] }[] = [
    { label: "Spend", tabs: [{ id: "spend", label: "Spend" }] },
    { label: "Compute", tabs: [{ id: "compute", label: "Compute" }] },
    { label: "Resources", tabs: [{ id: "services", label: "Services" }, { id: "inventory", label: "Inventory" }, { id: "quotas", label: "Quotas" }] },
    { label: "Security", tabs: [{ id: "access", label: "Access" }, { id: "accounts", label: "SAs & keys" }, { id: "keys", label: "API keys" }, { id: "exposure", label: "Exposure" }] },
    { label: "Traffic", tabs: [{ id: "traffic", label: "API traffic" }] },
    { label: "Recommendations", tabs: [{ id: "recommendations", label: "Recs" }] },
    { label: "Activity", tabs: [{ id: "activity", label: "Activity" }] },
  ];

  // The briefing is always loaded for the header and insight list.
  const overview = query<OverviewData>("skywalker_overview", () => ({ project_id: id }), { refreshEveryMs: 5 * 60_000, maxAgeSecs: 120 });
  // Month picker: "" = month to date, otherwise "YYYY-MM" (the server's own window).
  let spendMonth = $state("");
  const spend = query<any>("skywalker_spend", () => ({ project_id: id, group_by: "service", limit: 25, ...(spendMonth ? { month: spendMonth } : {}) }), { refreshEveryMs: 5 * 60_000, maxAgeSecs: 120, enabled: () => tab === "spend" });
  const spendSku = query<any>("skywalker_spend", () => ({ project_id: id, group_by: "sku", limit: 15, ...(spendMonth ? { month: spendMonth } : {}) }), { refreshEveryMs: 5 * 60_000, maxAgeSecs: 120, enabled: () => tab === "spend" });
  const spendDay = query<any>("skywalker_spend", () => ({ project_id: id, group_by: "day", days: 30, limit: 60 }), { refreshEveryMs: 5 * 60_000, maxAgeSecs: 120, enabled: () => tab === "spend" });
  const compute = query<any>("skywalker_compute", () => ({ project_id: id, limit: 200 }), { refreshEveryMs: 5 * 60_000, maxAgeSecs: 120, enabled: () => tab === "compute" });
  const services = query<any>("skywalker_services", () => ({ project_id: id }), { refreshEveryMs: 5 * 60_000, maxAgeSecs: 600, enabled: () => tab === "services" });
  const inventory = query<any>("skywalker_inventory", () => ({ project_id: id, limit: 200 }), { refreshEveryMs: 5 * 60_000, maxAgeSecs: 600, enabled: () => tab === "inventory" });
  const access = query<any>("skywalker_access", () => ({ project_id: id }), { refreshEveryMs: 5 * 60_000, maxAgeSecs: 300, enabled: () => tab === "access" });
  const accounts = query<any>("skywalker_service_accounts", () => ({ project_id: id, key_age_days: 90 }), { refreshEveryMs: 5 * 60_000, maxAgeSecs: 300, enabled: () => tab === "accounts" });
  const keys = query<any>("skywalker_api_keys", () => ({ project_id: id, days: 30 }), { refreshEveryMs: 5 * 60_000, maxAgeSecs: 300, enabled: () => tab === "keys" });
  const traffic = query<any>("skywalker_api_traffic", () => ({ project_id: id, days: 7 }), { refreshEveryMs: 5 * 60_000, maxAgeSecs: 300, enabled: () => tab === "traffic" });
  const exposure = query<any>("skywalker_exposure", () => ({ project_id: id }), { refreshEveryMs: 5 * 60_000, maxAgeSecs: 300, enabled: () => tab === "exposure" });
  const quotas = query<any>("skywalker_quotas", () => ({ project_id: id }), { refreshEveryMs: 5 * 60_000, maxAgeSecs: 600, enabled: () => tab === "quotas" });
  const recs = query<any>("skywalker_recommendations", () => ({ project_id: id, limit: 100 }), { refreshEveryMs: 5 * 60_000, maxAgeSecs: 600, enabled: () => tab === "recommendations" });
  const activity = query<any>("skywalker_activity", () => ({ project_id: id, days: 7, limit: 200 }), { refreshEveryMs: 5 * 60_000, maxAgeSecs: 120, enabled: () => tab === "activity" });

  // The dedicated budget tool: thresholds, throttle topic and basis for the header box.
  const budgetTool = query<any>("skywalker_budget", () => ({ project_id: id }), { refreshEveryMs: 5 * 60_000, maxAgeSecs: 300 });
  const all = [budgetTool, overview, spend, spendSku, spendDay, compute, services, inventory, access, accounts, keys, traffic, exposure, quotas, recs, activity];

  // Load the briefing and the open tab.
  let lastKey = "";
  $effect(() => {
    const k = `${id}|${tab}`;
    if (k === lastKey) return;
    lastKey = k;
    void overview.refresh();
    void budgetTool.refresh();
    switch (tab) {
      case "spend": void spend.refresh(); void spendSku.refresh(); void spendDay.refresh(); break;
      case "compute": void compute.refresh(); break;
      case "services": void services.refresh(); break;
      case "inventory": void inventory.refresh(); break;
      case "access": void access.refresh(); break;
      case "accounts": void accounts.refresh(); break;
      case "keys": void keys.refresh(); break;
      case "traffic": void traffic.refresh(); break;
      case "exposure": void exposure.refresh(); break;
      case "quotas": void quotas.refresh(); break;
      case "recommendations": void recs.refresh(); break;
      case "activity": void activity.refresh(); break;
    }
  });
  onDestroy(() => all.forEach((q) => q.stop()));

  const o = $derived(overview.data);
  // The last six billing months, newest first, for the picker.
  const recentMonthList = $derived(recentMonths(new Date(now.value), 7).slice(0, 6).reverse());
  const nowDate = $derived(new Date(now.value));
  // Prefer the dedicated budget tool's answer; the briefing copy is the fallback.
  const budget = $derived(budgetTool.data?.budgets?.[0] ?? o?.budget?.budgets?.[0] ?? null);
  const burnInfo = $derived(budget ? burn(budget.spend_this_month, budget.amount, budget.per_day_7d, nowDate) : null);
  const insights = $derived<Insight[]>(o ? projectInsights(o, nowDate) : []);
  const labels = $derived(o?.project?.labels ?? {});
  const owner = $derived(labels.owner ?? labels.pi ?? labels.contact ?? null);
  const lab = $derived(labels.lab ?? null);

  function selectTab(t: string) {
    router.go(projectPath(id, t));
  }

  // ---- spend ----
  const svcItems = $derived((spend.data?.items ?? []) as { service: string; gross: number; net: number; credits: number }[]);
  // Skywalker truncates at `limit`. When the listed services do not add up to the total,
  // the rest is shown as "Other services" so the total is never silently short.
  const svcOther = $derived.by(() => {
    const t = spend.data?.total?.gross;
    if (!isNum(t) || !spend.data?.truncated) return null;
    const listed = svcItems.reduce((s, x) => s + x.gross, 0);
    const rest = t - listed;
    return rest > 0.005 ? rest : null;
  });
  const skuItems = $derived((spendSku.data?.items ?? []) as { sku: string; gross: number; net: number; credits: number }[]);
  const dayItems = $derived((spendDay.data?.items ?? []) as { day: string; gross: number }[]);
  const spendDayOpt = $derived({
    grid: { left: 52, right: 14, top: 12, bottom: 28 },
    tooltip: { trigger: "axis", valueFormatter: (v: number) => `${money(v, { cents: true })} gross` },
    xAxis: { type: "category", data: dayItems.map((d) => d.day.slice(5)), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: C.muted, fontSize: 11, hideOverlap: true } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 11, formatter: (v: number) => moneyCompact(v) } },
    series: [{ type: "bar", data: dayItems.map((d) => d.gross), itemStyle: { color: C.accent, borderRadius: [4, 4, 0, 0] }, barMaxWidth: 16 }],
  });
  const svcOpt = $derived({
    grid: { left: 8, right: 56, top: 4, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => `${money(v, { cents: true })} gross` },
    xAxis: { type: "value", show: false, splitLine: { show: false } },
    yAxis: { type: "category", data: svcItems.map((s) => s.service).reverse(), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: C.muted, fontSize: 11, width: 170, overflow: "truncate" } },
    series: [{ type: "bar", data: svcItems.map((s) => s.gross).reverse(), itemStyle: { color: (p: { dataIndex: number }) => SERIES[p.dataIndex % SERIES.length], borderRadius: [0, 4, 4, 0] }, barMaxWidth: 14, label: { show: true, position: "right", color: C.muted, fontSize: 11, formatter: (p: { value: number }) => money(p.value) } }],
  });

  // ---- compute ----
  const cs = $derived(compute.data?.summary ?? null);
  const vmRows = $derived((compute.data?.instances ?? []) as any[]);
  const diskRows = $derived((compute.data?.disks ?? []) as any[]);
  const idleVms = $derived(vmRows.filter((v) => v.status === "TERMINATED" || v.status === "STOPPED"));

  // ---- access ----
  const accessFlagged = $derived((access.data?.flagged ?? []) as { member: string; type: string; roles: string[]; flags: string[] }[]);
  const accessAll = $derived((access.data?.all ?? []) as { member: string; type: string; roles: string[]; flags: string[] }[]);

  // ---- quotas ----
  const quotaUse = $derived((quotas.data?.in_use ?? []) as { region: string; metric: string; usage: number; limit: number; pct: number }[]);

  // ---- recs ----
  const recItems = $derived((recs.data?.items ?? []) as { kind: string; resource: string; description: string; monthly_saving: number; priority: string; location: string }[]);
  const recSaving = $derived(recs.data?.total_monthly_saving ?? null);

  // ---- exposure ----
  const risks = $derived((exposure.data?.risks ?? []) as string[]);
  // Item 4: the full answer, shown as tables. Every field is optional; missing ones show "--".
  const openFw = $derived((exposure.data?.open_firewall_rules ?? []) as { rule?: string; network?: string; exposes?: string[]; target_tags?: string[]; priority?: number | null }[]);
  const extVms = $derived((exposure.data?.vms_with_external_ip ?? []) as { vm?: string; zone?: string; state?: string; external_ips?: string[] }[]);
  const publicIam = $derived((exposure.data?.public_iam ?? []) as { resource?: string; type?: string; public_roles?: string[] }[]);
  const sccTop = $derived((exposure.data?.security_command_center?.top ?? []) as { category?: string; severity?: string; class?: string; resource?: string; since?: string }[]);
  // "Right now" must count the briefing's own exposure block: the exposure query only runs on
  // the Exposure tab, so using `risks` there showed an invented 0 on every other tab.
  const briefRisks = $derived(((o as any)?.exposure?.risks ?? []) as string[]);

</script>

<div class="header">
  <div class="title-row">
    <div>
      <div class="caps">Project</div>
      <h1 class="mono">{id}</h1>
      <div class="meta">
        {#if o?.project?.name}<span>{o.project.name}</span>{/if}
        {#if lab && owner && lab === owner}<span class="pill info">lab and owner: {lab}</span>
        {:else}
          {#if lab}<span class="pill info">lab: {lab}</span>{/if}
          {#if owner}<span class="pill">owner: {owner}</span>{/if}
        {/if}
        {#if o?.project?.billing_enabled === false}<span class="pill warn">billing off</span>{/if}
        <span class="faint tiny">updated {overview.ago}</span>
      </div>
    </div>
    <span class="spacer"></span>
    {#if budget}
      <div class="budget-box card flat">
        <div class="kpi-label">Budget {budget.period === "MONTH" ? "this month" : ""}</div>
        <div class="hero sm num" style="color:{heatColor(budget.pct)}">{pct(budget.pct)} <span class="faint" style="font-size:14px;font-weight:500">used</span></div>
        <Meter value={budget.pct} />
        <div class="tiny faint" style="margin-top:6px">{money(budget.spend_this_month)} of {money(budget.amount)} · {money(burnInfo?.recentPerDay ?? burnInfo?.burnPerDay)}/day ({budget.spend_basis === "net" ? "net" : "gross"}){isNum(burnInfo?.recentPerDay) ? ", last 7 days" : ", month average"}</div>
        <div class="tiny faint">{budget.spend_basis === "net" ? "This budget counts net (after credits)." : budget.spend_basis === "gross" ? "This budget counts gross (before credits)." : "Skywalker did not report the basis."}</div>
      </div>
    {/if}
    <button class="btn small" onclick={() => overview.refresh(true)} disabled={overview.loading}>{overview.loading ? "Refreshing…" : "Refresh"}</button>
  </div>

  {#if overview.error}
    <div class="notice error" role="alert" style="margin-top:14px">{overview.error.message}</div>
  {/if}
</div>

<div class="grid g2 briefing" style="margin-top:14px; grid-template-columns: 1.2fr 1fr; align-items: start;">
  <Section title="What is happening here" sub="findings from Skywalker" loading={overview.loading && !o} error={overview.error && !o ? overview.error : null} empty={!o} emptyText="Loading the briefing…" ago={overview.ago}>
    <Insights items={insights} limit={14} empty="No findings. Skywalker reported nothing that needs attention." />
  </Section>
  <Section title="Right now" sub="from the briefing" loading={overview.loading && !o} error={null} empty={!o} emptyText="Loading…">
    <div class="grid g2" style="gap:10px">
      <div class="stat"><div class="kpi-label">VMs running</div><div class="hero sm num">{o?.compute?.summary ? `${int(o.compute.summary.vms_running)} / ${int(o.compute.summary.vms)}` : DASH}</div></div>
      <div class="stat"><div class="kpi-label">Spend, {o?.spend?.window?.label ?? "this month"}</div><div class="hero sm num">{moneyG(o?.spend?.total?.gross)}</div><div class="kpi-sub">{moneyN(o?.spend?.total?.net)}</div></div>
      <div class="stat"><div class="kpi-label">Public risks</div><div class="hero sm num" style="color:{briefRisks.length ? C.alert : 'inherit'}">{o?.exposure ? int(briefRisks.length) : DASH}</div></div>
      <div class="stat"><div class="kpi-label">Google savings</div><div class="hero sm num">{money(o?.recommendations?.total_monthly_saving ?? null)}</div><div class="kpi-sub">per month, list price</div></div>
    </div>
    {#if computeSentence(o?.compute?.summary)}<p class="muted small" style="margin-top:12px">{computeSentence(o?.compute?.summary)}</p>{/if}
    {#if o?.unavailable && Object.keys(o.unavailable).length}
      <div class="tiny faint" style="margin-top:12px">Unavailable in the briefing: {Object.keys(o.unavailable).join(", ")}. Open the tab to see why.</div>
    {/if}
  </Section>
</div>

<div class="tabs" role="tablist" style="margin-top:18px">
  {#each TAB_GROUPS as g, gi (g.label)}
    {#if gi > 0}<span class="tab-divider" aria-hidden="true"></span>{/if}
    {#each g.tabs as t (t.id)}
      <button class="tab {tab === t.id ? 'active' : ''}" role="tab" aria-selected={tab === t.id} title="{g.label}: {t.label}" onclick={() => selectTab(t.id)}>{t.label}</button>
    {/each}
  {/each}
</div>

<div class="grid">
  {#if tab === "spend"}
    <div class="grid g2">
      <Section title="Spend by day" sub="last 30 days, gross" loading={spendDay.loading && !spendDay.data} error={spendDay.error} empty={!dayItems.length} emptyText="No daily spend found for this project." ago={spendDay.ago}>
        <Chart option={spendDayOpt} height="260px" label="Daily spend" />
      </Section>
      <Section title="Spend by service" sub="gross, this month" loading={spend.loading && !spend.data} error={spend.error} empty={!svcItems.length} emptyText="No service spend this month." ago={spend.ago}>
        <Chart option={svcOpt} height="{Math.max(120, svcItems.length * 28 + 24)}px" label="Spend by service" />
        <div class="tiny faint" style="margin-top:6px">Gross is usage at list price before credits. Net = gross + credits (credits are negative). Each budget says which basis it counts.</div>
      </Section>
    </div>
    <div class="month-bar">
      <span class="tiny faint">Window</span>
      <div class="seg" role="group" aria-label="Month">
        <button class:on={spendMonth === ""} onclick={() => (spendMonth = "")}>Month to date</button>
        {#each recentMonthList as m (m)}<button class:on={spendMonth === m} onclick={() => (spendMonth = m)}>{m}</button>{/each}
      </div>
    </div>
    <Section title="Totals" sub={`${spend.data?.window?.label ?? "window"} · gross = before credits; credits are negative; net = gross + credits`} loading={spend.loading && !spend.data} error={spend.error} empty={!spend.data} emptyText="--" ago={spend.ago}>
      <div class="grid g3" style="gap:10px">
        <div class="stat"><div class="kpi-label">Gross, before credits</div><div class="hero sm num">{moneyG(spend.data?.total?.gross)}</div>{#if svcOther !== null}<div class="kpi-sub">includes {money(svcOther)} in other services not listed</div>{/if}</div>
        <div class="stat"><div class="kpi-label">Credits, all types</div><div class="hero sm num">{creditsText(spend.data?.total?.credits)}</div><div class="kpi-sub">negative; not split by type yet</div></div>
        <div class="stat"><div class="kpi-label">Net, after credits</div><div class="hero sm num">{moneyN(spend.data?.total?.net)}</div></div>
      </div>
    </Section>
    <Section title="Top SKUs" sub="gross, sorted by Skywalker; service / sku" loading={spendSku.loading && !spendSku.data} error={spendSku.error} empty={!!spendSku.data && !skuItems.length} emptyText="No SKU spend in this window." ago={spendSku.ago}>
      <Table rows={skuItems as any[]} rowKey={(r, i) => r.sku ?? r.service ?? String(i)} cols={[
        { key: "sku", label: "Service / SKU", value: (r) => r.sku ?? r.service ?? "--", fmt: (r) => r.sku ?? r.service ?? "--", wrap: true },
        { key: "gross", label: "Gross", value: (r) => r.gross, fmt: (r) => money(r.gross), align: "r" },
        { key: "credits", label: "Credits, all types", value: (r) => r.credits, fmt: (r) => money(r.credits), align: "r" },
        { key: "net", label: "Net, after credits", value: (r) => r.net, fmt: (r) => money(r.net), align: "r" },
      ]} />
    </Section>
  {:else if tab === "compute"}
    <div class="grid g4">
      <div class="card"><div class="kpi-label">VMs running</div><div class="hero sm num">{cs ? `${int(cs.vms_running)} of ${int(cs.vms)}` : DASH}</div><div class="kpi-sub">{cs?.vms_with_gpu ? `${int(cs.vms_with_gpu)} with GPUs` : "no GPU VMs"}</div></div>
      <div class="card"><div class="kpi-label">Unattached disks</div><div class="hero sm num" style="color:{(cs?.unattached_disk_gb ?? 0) >= 100 ? C.warn : 'inherit'}">{cs ? int(cs.unattached_disks) : DASH}</div><div class="kpi-sub">{cs ? `${gb(cs.unattached_disk_gb)} still billing` : ""}</div></div>
      <div class="card"><div class="kpi-label">Reserved IPs unused</div><div class="hero sm num">{cs ? int(cs.unused_external_ips) : DASH}</div><div class="kpi-sub">{cs ? `${int(cs.static_ips)} static IPs in total` : ""}</div></div>
      <div class="card"><div class="kpi-label">Snapshots</div><div class="hero sm num">{cs ? int(cs.snapshots) : DASH}</div><div class="kpi-sub">{cs ? `${gb(cs.snapshot_stored_gb)} stored` : ""}</div></div>
    </div>
    <Section title="Virtual machines" sub="running first" loading={compute.loading && !compute.data} error={compute.error} empty={!vmRows.length} emptyText="No VMs in this project." ago={compute.ago}>
      <Table rows={vmRows} rowKey={(r) => `${r.zone}/${r.name}`} cols={[
        { key: "name", label: "Name", value: (r) => r.name },
        { key: "zone", label: "Zone", value: (r) => r.zone },
        { key: "status", label: "State", value: (r) => r.status },
        { key: "machine", label: "Machine", value: (r) => r.machine_type },
        { key: "gpu", label: "GPUs", value: (r) => (r.gpus?.length ? r.gpus.join(", ") : "--") },
        { key: "ext", label: "External IP", value: (r) => (r.external_ips?.length ? "yes" : "no") },
        { key: "stopped", label: "Stopped for", value: (r) => r.stopped_days ?? null, fmt: (r) => (r.stopped_days == null ? DASH : `${r.stopped_days} d`), align: "r" },
      ]} />
    </Section>
    <Section title="Disks" sub="unattached first" loading={compute.loading && !compute.data} error={null} empty={!diskRows.length} emptyText="No disks.">
      <Table rows={diskRows} rowKey={(r) => `${r.location}/${r.name}`} cols={[
        { key: "name", label: "Name", value: (r) => r.name },
        { key: "loc", label: "Location", value: (r) => r.location },
        { key: "type", label: "Type", value: (r) => r.type },
        { key: "size", label: "Size", value: (r) => r.size_gb, fmt: (r) => gb(r.size_gb), align: "r" },
        { key: "att", label: "Attached to", value: (r) => (r.attached_to?.length ? r.attached_to.join(", ") : "nothing"), wrap: true },
      ]} />
    </Section>
    {#if idleVms.length}
      <div class="tiny faint">{idleVms.length} VM{idleVms.length === 1 ? " is" : "s are"} stopped. Stopped VMs still pay for their disks.</div>
    {/if}
  {:else if tab === "services"}
    <Section title="Enabled APIs" sub={services.data ? `${int(services.data.enabled)} enabled` : ""} loading={services.loading && !services.data} error={services.error} empty={!services.data} emptyText="No services reported." ago={services.ago}>
      {#if services.data?.costly_or_notable?.length}
        <div style="margin-bottom:12px">
          <div class="caps" style="margin-bottom:6px">Usually cost money or worth a look</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            {#each services.data.costly_or_notable as s (s)}<span class="pill warn mono">{s}</span>{/each}
          </div>
        </div>
      {/if}
      <div class="caps" style="margin-bottom:6px">All enabled</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        {#each services.data?.services ?? [] as s (s)}<span class="pill mono">{s}</span>{/each}
      </div>
    </Section>
  {:else if tab === "inventory"}
    <Section title="Assets by type" sub={inventory.data ? `${int(inventory.data.resources)} resources` : ""} loading={inventory.loading && !inventory.data} error={inventory.error} empty={!inventory.data} emptyText="Inventory not available." ago={inventory.ago}>
      <div class="grid g4" style="gap:10px">
        {#each Object.entries(inventory.data?.notable ?? {}) as [k, v] (k)}
          <div class="stat"><div class="kpi-label">{k.replaceAll("_", " ")}</div><div class="hero sm num">{int(v as number)}</div></div>
        {:else}
          <div class="empty">No notable asset types.</div>
        {/each}
      </div>
      <div class="caps" style="margin:16px 0 6px">Every type</div>
      <Table rows={Object.entries(inventory.data?.by_type ?? {}).map(([t, n]) => ({ t, n }))} cols={[
        { key: "t", label: "Asset type", value: (r) => r.t },
        { key: "n", label: "Count", value: (r) => r.n as number, align: "r" },
      ]} />
    </Section>
  {:else if tab === "access"}
    <div class="grid g4">
      <div class="card"><div class="kpi-label">Members</div><div class="hero sm num">{access.data ? int(access.data.members) : DASH}</div></div>
      <div class="card"><div class="kpi-label">Owners</div><div class="hero sm num">{access.data ? int(access.data.owners?.length ?? 0) : DASH}</div></div>
      <div class="card"><div class="kpi-label">Flagged</div><div class="hero sm num" style="color:{accessFlagged.length ? C.warn : 'inherit'}">{access.data ? int(accessFlagged.length) : DASH}</div></div>
      <div class="card"><div class="kpi-label">Public grants</div><div class="hero sm num" style="color:{accessFlagged.some((m) => m.flags.includes('public')) ? C.alert : 'inherit'}">{access.data ? int(accessFlagged.filter((m) => m.flags.includes("public")).length) : DASH}</div></div>
    </div>
    <Section title="Flagged access" sub="public, outside the domain, admin roles, default service accounts" loading={access.loading && !access.data} error={access.error} empty={!accessFlagged.length} emptyText="Nothing flagged." ago={access.ago}>
      <Table rows={accessFlagged} rowKey={(r) => r.member} cols={[
        { key: "m", label: "Member", value: (r) => r.member, wrap: true },
        { key: "roles", label: "Roles", value: (r) => r.roles.join(", "), wrap: true },
        { key: "flags", label: "Why flagged", value: (r) => r.flags.join(", "), wrap: true },
      ]} />
    </Section>
    <Section title="Everyone with access" sub={access.data?.truncated ? "first 200" : ""} loading={access.loading && !access.data} error={null} empty={!accessAll.length} emptyText="No members.">
      <Table rows={accessAll} rowKey={(r) => r.member} max={200} cols={[
        { key: "m", label: "Member", value: (r) => r.member, wrap: true },
        { key: "type", label: "Type", value: (r) => r.type },
        { key: "roles", label: "Roles", value: (r) => r.roles.join(", "), wrap: true },
      ]} />
    </Section>
  {:else if tab === "accounts"}
    <div class="grid g3">
      <div class="card"><div class="kpi-label">Service accounts</div><div class="hero sm num">{accounts.data ? int(accounts.data.service_accounts) : DASH}</div></div>
      <div class="card"><div class="kpi-label">Keys older than {accounts.data?.keys_older_than_days ?? 90} days</div><div class="hero sm num" style="color:{(accounts.data?.old_keys ?? 0) ? C.warn : 'inherit'}">{accounts.data ? int(accounts.data.old_keys) : DASH}</div></div>
      <div class="card"><div class="kpi-label">Unused 90+ days</div><div class="hero sm num">{accounts.data ? int(accounts.data.never_or_long_unused?.length ?? 0) : DASH}</div></div>
    </div>
    <Section title="Service accounts and keys" sub="last authentication from Policy Analyzer" loading={accounts.loading && !accounts.data} error={accounts.error} empty={!(accounts.data?.accounts?.length)} emptyText="No service accounts." ago={accounts.ago}>
      <Table rows={(accounts.data?.accounts ?? []) as any[]} rowKey={(r) => r.email} cols={[
        { key: "email", label: "Account", value: (r) => r.email, wrap: true },
        { key: "keys", label: "User keys", value: (r) => r.user_managed_keys.length, align: "r" },
        { key: "old", label: "Old keys", value: (r) => r.old_keys, align: "r" },
        { key: "age", label: "Oldest key", value: (r) => oldestAge(r), fmt: (r) => { const a = oldestAge(r); return a == null ? DASH : `${a} d`; }, align: "r" },
        { key: "last", label: "Last used", value: (r) => r.last_authenticated ?? null, fmt: (r) => shortDate(r.last_authenticated), align: "r" },
      ]} />
    </Section>
  {:else if tab === "keys"}
    <div class="grid g3">
      <div class="card"><div class="kpi-label">API keys</div><div class="hero sm num">{keys.data ? int(keys.data.keys) : DASH}</div></div>
      <div class="card"><div class="kpi-label">No API restriction</div><div class="hero sm num" style="color:{(keys.data?.unrestricted ?? 0) ? C.warn : 'inherit'}">{keys.data ? int(keys.data.unrestricted) : DASH}</div></div>
      <div class="card"><div class="kpi-label">Unused in {keys.data?.window_days ?? 30} days</div><div class="hero sm num">{keys.data ? int(keys.data.unused_in_window?.length ?? 0) : DASH}</div></div>
    </div>
    <Section title="API keys" sub="key strings are never read" loading={keys.loading && !keys.data} error={keys.error} empty={!(keys.data?.items?.length)} emptyText="No API keys." ago={keys.ago}>
      <Table rows={(keys.data?.items ?? []) as any[]} rowKey={(r) => r.name} cols={[
        { key: "n", label: "Name", value: (r) => r.name, wrap: true },
        { key: "t", label: "Restricted to", value: (r) => (r.api_targets?.length ? r.api_targets.join(", ") : "any API"), wrap: true },
        { key: "age", label: "Age", value: (r) => r.age_days ?? null, fmt: (r) => (r.age_days == null ? DASH : `${r.age_days} d`), align: "r" },
        { key: "req", label: "Requests", value: (r) => r[`requests_${keys.data?.window_days ?? 30}d`] ?? 0, align: "r" },
        { key: "flags", label: "Flags", value: (r) => r.flags.join(", "), wrap: true },
      ]} />
    </Section>
  {:else if tab === "traffic"}
    <Section title="Requests by API" sub="last {traffic.data?.window_days ?? 7} days" loading={traffic.loading && !traffic.data} error={traffic.error} empty={!(traffic.data?.items?.length)} emptyText="No API traffic in this window." ago={traffic.ago}>
      <Table rows={(traffic.data?.items ?? []) as any[]} rowKey={(r) => r.name} cols={[
        { key: "n", label: "API", value: (r) => r.name },
        { key: "r", label: "Requests", value: (r) => r.requests, align: "r" },
        { key: "e", label: "Errors (4xx/5xx)", value: (r) => r.errors, align: "r" },
        { key: "p", label: "Error rate", value: (r) => (r.requests ? r.errors / r.requests : null), fmt: (r) => (r.requests ? pct((r.errors / r.requests) * 100, 1) : DASH), align: "r" },
      ]} />
    </Section>
  {:else if tab === "exposure"}
    <div class="grid g4">
      <div class="card"><div class="kpi-label">Public risks</div><div class="hero sm num" style="color:{risks.length ? C.alert : 'inherit'}">{exposure.data ? int(risks.length) : DASH}</div></div>
      <div class="card"><div class="kpi-label">Open firewall rules</div><div class="hero sm num">{exposure.data ? int(openFw.length) : DASH}</div></div>
      <div class="card"><div class="kpi-label">VMs with external IPs</div><div class="hero sm num">{exposure.data ? int(extVms.length) : DASH}</div></div>
      <div class="card"><div class="kpi-label">Public IAM bindings</div><div class="hero sm num" style="color:{publicIam.length ? C.alert : 'inherit'}">{exposure.data ? int(publicIam.length) : DASH}</div></div>
    </div>
    <Section title="What is exposed" sub="summary from Skywalker" loading={exposure.loading && !exposure.data} error={exposure.error} empty={!exposure.data} emptyText="--" ago={exposure.ago}>
      {#if risks.length}
        <Insights items={risks.map((r) => ({ level: r.startsWith("firewall") || r.includes("public") ? "alert" : "warn", area: "exposure", text: r }))} />
      {:else}
        <div class="empty">Nothing public or open to the internet.</div>
      {/if}
    </Section>
    <div class="grid g2" style="margin-top:14px">
      <Section title="Open firewall rules" sub="ingress rules that open ports to the internet" loading={exposure.loading && !exposure.data} error={null} empty={!!exposure.data && !openFw.length} emptyText="No open firewall rules." ago="">
        <Table rows={openFw} rowKey={(r, i) => `${r.rule ?? "--"}-${i}`} cols={[
          { key: "rule", label: "Rule", value: (r) => r.rule ?? "--", fmt: (r) => r.rule ?? "--", wrap: true },
          { key: "net", label: "Network", value: (r) => r.network ?? "--", fmt: (r) => r.network ?? "--" },
          { key: "exp", label: "Exposes", value: (r) => (r.exposes ?? []).join(", ") || "--", fmt: (r) => (r.exposes ?? []).join(", ") || "--", wrap: true },
          { key: "tags", label: "Target tags", value: (r) => (r.target_tags ?? []).join(", ") || "all", fmt: (r) => (r.target_tags ?? []).join(", ") || "all", wrap: true },
          { key: "prio", label: "Priority", value: (r) => r.priority ?? null, fmt: (r) => (r.priority === null || r.priority === undefined ? "--" : String(r.priority)), align: "r", nowrap: true },
        ]} />
      </Section>
      <Section title="VMs with external IPs" sub="instances reachable on a public address" loading={exposure.loading && !exposure.data} error={null} empty={!!exposure.data && !extVms.length} emptyText="No VMs with external IPs." ago="">
        <Table rows={extVms} rowKey={(r, i) => `${r.vm ?? "--"}-${i}`} cols={[
          { key: "vm", label: "VM", value: (r) => r.vm ?? "--", fmt: (r) => r.vm ?? "--", wrap: true },
          { key: "zone", label: "Zone", value: (r) => r.zone ?? "--", fmt: (r) => r.zone ?? "--", nowrap: true },
          { key: "state", label: "State", value: (r) => r.state ?? "--", fmt: (r) => r.state ?? "--", nowrap: true },
          { key: "ips", label: "External IPs", value: (r) => (r.external_ips ?? []).join(", ") || "--", fmt: (r) => (r.external_ips ?? []).join(", ") || "--", wrap: true },
        ]} />
      </Section>
    </div>
    <div class="grid g2" style="margin-top:14px">
      <Section title="Public IAM" sub="resources granted to allUsers or allAuthenticatedUsers" loading={exposure.loading && !exposure.data} error={null} empty={!!exposure.data && !publicIam.length} emptyText="No public IAM bindings." ago="">
        <Table rows={publicIam} rowKey={(r, i) => `${r.resource ?? "--"}-${i}`} cols={[
          { key: "res", label: "Resource", value: (r) => shortResource(r.resource), fmt: (r) => shortResource(r.resource), wrap: true },
          { key: "type", label: "Type", value: (r) => r.type ?? "--", fmt: (r) => r.type ?? "--", wrap: true },
          { key: "roles", label: "Public roles", value: (r) => (r.public_roles ?? []).join(", ") || "--", fmt: (r) => (r.public_roles ?? []).join(", ") || "--", wrap: true },
        ]} />
      </Section>
      <Section title="Security Command Center" sub="active findings by severity" loading={exposure.loading && !exposure.data} error={null} empty={!exposure.data?.security_command_center} emptyText="Security Command Center is not reporting here.">
        <div class="grid g4" style="gap:10px">
          {#each Object.entries(exposure.data?.security_command_center?.by_severity ?? {}) as [sev, n] (sev)}
            <div class="stat"><div class="kpi-label">{sev.toLowerCase()}</div><div class="hero sm num">{int(n as number)}</div></div>
          {:else}
            <div class="empty">No active findings.</div>
          {/each}
        </div>
      </Section>
    </div>
    <div style="margin-top:14px">
      <Section title="Security Command Center findings" sub="most severe first; the list is what Skywalker returned" loading={exposure.loading && !exposure.data} error={null} empty={!!exposure.data && !sccTop.length} emptyText="No findings listed." ago="">
        <Table rows={sccTop} rowKey={(r, i) => `${r.resource ?? "--"}-${i}`} cols={[
          { key: "sev", label: "Severity", value: (r) => r.severity ?? "--", fmt: (r) => r.severity ?? "--", nowrap: true },
          { key: "cat", label: "Category", value: (r) => r.category ?? "--", fmt: (r) => r.category ?? "--", wrap: true },
          { key: "cls", label: "Class", value: (r) => r.class ?? "--", fmt: (r) => r.class ?? "--", nowrap: true },
          { key: "res", label: "Resource", value: (r) => r.resource ?? "--", fmt: (r) => r.resource ?? "--", wrap: true },
          { key: "since", label: "Since", value: (r) => r.since ?? null, fmt: (r) => shortDate(r.since), nowrap: true },
        ]} />
      </Section>
    </div>
  {:else if tab === "quotas"}
    <Section title="Regional usage vs limit" sub="Compute Engine, near-limit flagged at 80%" loading={quotas.loading && !quotas.data} error={quotas.error} empty={!quotaUse.length} emptyText="No Compute quota in use." ago={quotas.ago}>
      <div class="qlist">
        {#each quotaUse as q (q.region + q.metric)}
          <div class="qrow">
            <div class="qname"><span class="mono">{q.metric}</span> <span class="faint tiny">{q.region}</span></div>
            <div class="qbar"><Meter value={q.pct} /></div>
            <div class="qnum num">{int(q.usage)} / {int(q.limit)} <span class="faint">({pct(q.pct, 0)})</span></div>
          </div>
        {/each}
      </div>
    </Section>
    <Section title="GPU quota limits" sub="from Cloud Quotas" loading={quotas.loading && !quotas.data} error={null} empty={!(quotas.data?.gpu_quotas?.length)} emptyText="No GPU quotas reported.">
      <Table rows={(quotas.data?.gpu_quotas ?? []) as any[]} rowKey={(r) => r.quota} cols={[
        { key: "q", label: "Quota", value: (r) => r.quota, wrap: true },
        { key: "m", label: "Highest limit", value: (r) => r.max_limit, align: "r" },
        { key: "r", label: "Regions", value: (r) => r.regions, align: "r" },
      ]} />
    </Section>
  {:else if tab === "recommendations"}
    <div class="grid g3">
      <div class="card"><div class="kpi-label">Potential savings</div><div class="hero sm num" style="color:{C.good}">{money(recSaving)}</div><div class="kpi-sub">per month, list price</div></div>
      <div class="card"><div class="kpi-label">Recommendations</div><div class="hero sm num">{recs.data ? int(recItems.length) : DASH}</div></div>
      <div class="card"><div class="kpi-label">Locations checked</div><div class="hero sm num">{recs.data?.asked?.calls ? int(recs.data.asked.calls) : DASH}</div><div class="kpi-sub">recommender calls</div></div>
    </div>
    <Section title="Google recommendations" sub="sorted by monthly savings" loading={recs.loading && !recs.data} error={recs.error} empty={!recItems.length} emptyText="No open recommendations." ago={recs.ago}>
      <Table rows={recItems} rowKey={(r, i) => `${r.kind}-${i}`} cols={[
        { key: "k", label: "Kind", value: (r) => r.kind },
        { key: "d", label: "What", value: (r) => r.description, wrap: true },
        { key: "r", label: "Resource", value: (r) => r.resource, wrap: true },
        { key: "s", label: "Saving / mo", value: (r) => r.monthly_saving, fmt: (r) => money(r.monthly_saving), align: "r" },
      ]} />
    </Section>
  {:else if tab === "activity"}
    <Section title="Admin activity" sub="last 7 days, newest first" loading={activity.loading && !activity.data} error={activity.error} empty={!(activity.data?.items?.length)} emptyText="No admin changes in the last 7 days." ago={activity.ago}>
      {#if activity.data?.by_principal}
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
          {#each Object.entries(activity.data.by_principal).slice(0, 8) as [who, n] (who)}
            <span class="pill">{who || "unknown"} · {int(n as number)}</span>
          {/each}
        </div>
      {/if}
      <div class="timeline">
        {#each (activity.data?.items ?? []) as e, i (i)}
          <div class="tl-row">
            <div class="tl-time num">{shortTime(e.time)}</div>
            <div class="tl-dot {e.error ? 'bad' : ''}"></div>
            <div class="tl-body">
              <div><span class="mono" style="font-size:12.5px">{e.method}</span></div>
              <div class="tiny faint">{e.who || "unknown"} · {e.resource}{e.error ? ` · failed: ${e.error}` : ""}</div>
            </div>
          </div>
        {/each}
      </div>
    </Section>
  {/if}
</div>

<style>
  .header { padding-top: 4px; }
  /* Item 9: a 1 px divider between tab groups; captions only where a group has more than one tab. */
  .tab-divider { align-self: stretch; width: 1px; background: var(--stroke); margin: 6px 8px 7px; }
  /* Item 7: groups wrap onto more rows at narrow widths; nothing is hidden off-screen. */
  /* Size the insight card to its own content, not to its taller neighbour. */
  .briefing :global(section.card) { align-self: start; }
  .title-row { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
  h1 { margin: 4px 0 6px; font-size: 22px; letter-spacing: -0.01em; font-weight: 650; }
  .meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: var(--text-2); font-size: 13px; }
  .budget-box { min-width: 240px; padding: 12px 14px; }
  .stat { background: var(--surface-2); border: 1px solid var(--stroke); border-radius: 12px; padding: 12px 14px; }
  .qlist { display: grid; gap: 12px; }
  .qrow { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(120px, 1.2fr) minmax(140px, auto); gap: 14px; align-items: center; }
  .qnum { text-align: right; font-size: 13px; }
  .month-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
  .timeline { position: relative; padding-left: 4px; }
  .tl-row { display: grid; grid-template-columns: 120px 14px 1fr; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--stroke); }
  .tl-time { font-size: 12px; color: var(--text-3); }
  .tl-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); margin-top: 6px; box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent); }
  .tl-dot.bad { background: var(--alert, #ff5577); box-shadow: 0 0 0 4px rgba(255, 85, 119, 0.18); }
  .tl-body { min-width: 0; }
  @media (max-width: 1100px) { .qrow { grid-template-columns: 1fr; } }
</style>
