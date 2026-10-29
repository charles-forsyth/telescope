<script lang="ts">
  // All tools explorer: every tool from tools/list, a form built from its input
  // schema, and the answer rendered as readable sections plus raw JSON.
  import { onMount } from "svelte";
  import { bridge, asAppError, describeError, type ToolDef, type AppError } from "../lib/api";
  import { ago as agoText, money, int } from "../lib/format";
  import { now } from "../lib/clock.svelte";
  import { TOOL_GROUPS, TOOL_LABEL, ALL_TOOLS, groupOf } from "../lib/tools";
  import { router } from "../lib/router.svelte";
  import { callOnce } from "../lib/query.svelte";
  import Section from "../components/Section.svelte";
  import Table from "../components/Table.svelte";

  interface Props { tool: string | null; }
  let { tool }: Props = $props();

  let catalog = $state<ToolDef[]>([]);
  let catalogErr = $state<AppError | null>(null);
  let args = $state<Record<string, string>>({});
  let result = $state<{ data: unknown; fetched_at_ms: number; cached: boolean } | null>(null);
  let runErr = $state<AppError | null>(null);
  let running = $state(false);
  let raw = $state(false);
  let query = $state("");

  onMount(async () => {
    try {
      if (__DEMO__) {
        const { DEMO_TOOLS, DEMO_TOOL_DESC } = await import("../lib/demo");
        catalog = DEMO_TOOLS.map((name) => ({ name, description: DEMO_TOOL_DESC[name] ?? "" }));
        return;
      }
      const r = await bridge.listTools();
      catalog = r.tools ?? [];
    } catch (e) {
      catalogErr = asAppError(e);
    }
  });

  const current = $derived(catalog.find((t) => t.name === tool) ?? null);
  const schema = $derived(current?.inputSchema?.properties ?? {});
  const required = $derived(new Set(current?.inputSchema?.required ?? []));

  // Pre-fill a sensible default project for per-project tools.
  $effect(() => {
    if (!tool) return;
    const props = Object.keys(schema);
    const next: Record<string, string> = {};
    for (const k of props) {
      const d = schema[k]?.default;
      next[k] = d === undefined || d === null ? "" : String(d);
    }
    args = next;
    result = null;
    runErr = null;
  });

  function coerce(key: string, raw: string): unknown {
    const s = schema[key];
    const types = Array.isArray(s?.type) ? s.type : [s?.type];
    if (raw.trim() === "") return undefined;
    if (types.includes("integer") || types.includes("number")) {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    if (types.includes("boolean")) return raw === "true";
    return raw;
  }

  async function run(e: Event) {
    e.preventDefault();
    if (!tool) return;
    running = true;
    runErr = null;
    const payload: Record<string, unknown> = {};
    for (const k of Object.keys(schema)) {
      const v = coerce(k, args[k] ?? "");
      if (v !== undefined) payload[k] = v;
    }
    try {
      const r = await callOnce(tool, payload, 0);
      result = r;
    } catch (err) {
      runErr = asAppError(err);
      result = null;
    } finally {
      running = false;
    }
  }

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const names = catalog.length ? catalog.map((t) => t.name) : ALL_TOOLS;
    return names.filter((n) => !q || n.includes(q) || (TOOL_LABEL[n] ?? "").toLowerCase().includes(q));
  });

  /** The first sentence of a tool's description from tools/list, or a neutral line when the server sent none. */
  function firstSentence(d: string | undefined): string {
    if (!d) return "Description loads with the tool list.";
    const t = d.trim().split(/\n\s*\n/)[0].replace(/\s+/g, " ");
    const m = t.match(/^(.+?[.!?])(\s|$)/);
    return m ? m[1] : t;
  }

  function label(name: string): string {
    return TOOL_LABEL[name] ?? name.replace(/^skywalker_/, "");
  }

  // Render the result: top-level scalars as a key list, objects/arrays as sections.
  function entries(v: unknown): [string, unknown][] {
    return v && typeof v === "object" && !Array.isArray(v) ? Object.entries(v as Record<string, unknown>) : [];
  }
  function isScalar(v: unknown): boolean {
    return v === null || ["string", "number", "boolean"].includes(typeof v);
  }
  function fmtScalar(k: string, v: unknown): string {
    if (v === null || v === undefined) return "--";
    if (typeof v === "number") {
      // Money keys carry their basis: "net" and "credit" are net-side, the rest gross.
      if (/net/i.test(k)) return `${money(v)} net`;
      if (/credit/i.test(k)) return `${money(v)} credits (all types)`;
      if (/(gross|cost|saving|amount|spend)/i.test(k)) return `${money(v)} ${/saving/i.test(k) ? "list-price saving" : "gross"}`;
      return int(v);
    }
    if (typeof v === "boolean") return v ? "yes" : "no";
    return String(v);
  }
</script>

{#if __DEMO__}
  <div class="notice warn" style="margin-bottom:14px"><span>DEMO: fixtures only, not live Skywalker data.</span></div>
{/if}

<div class="explorer">
  <aside class="list card flat">
    <div class="search" style="max-width:none;margin-bottom:10px">
      <input class="input" style="width:100%" placeholder="Filter tools…" bind:value={query} aria-label="Filter tools" />
    </div>
    {#if catalogErr}
      <div class="notice error">{describeError(catalogErr)}</div>
    {/if}
    {#each TOOL_GROUPS as g (g.id)}
      {@const shown = g.tools.filter((t) => filtered.includes(t))}
      {#if shown.length}
        <div class="caps grp">{g.label}{g.staff ? " · staff" : ""}</div>
        {#each shown as t (t)}
          <button class="item {tool === t ? 'on' : ''}" onclick={() => router.go(`#/tools/${encodeURIComponent(t)}`)}>
            <span>{label(t)}</span>
            <span class="mono faint tiny slug" title={t}>{t.replace("skywalker_", "")}</span>
          </button>
        {/each}
      {/if}
    {/each}
    {#if catalog.length}
      <div class="tiny faint" style="margin-top:12px">{catalog.length} tools reported by the server.</div>
    {/if}
  </aside>

  <section class="pane">
    {#if !tool}
      <div class="card">
        <h2 class="h">All tools</h2>
        <p class="muted">Pick a tool. Each form is built from the server's own input schema, so every argument the server accepts is here. Calls are read-only.</p>
        <div class="tool-grid">
          {#each filtered as name (name)}
            <button class="tool-card" onclick={() => router.go(`#/tools/${encodeURIComponent(name)}`)}>
              <span class="caps">{groupOf(name)?.label ?? "Tool"}{groupOf(name)?.staff ? " · staff" : ""}</span>
              <span class="tool-name">{label(name)}</span>
              <span class="tiny faint mono">{name.replace("skywalker_", "")}</span>
              <span class="tool-desc">{firstSentence(catalog.find((t) => t.name === name)?.description)}</span>
            </button>
          {:else}
            <div class="faint small">No tool matches that filter.</div>
          {/each}
        </div>
      </div>
    {:else}
      <div class="card">
        <div class="head">
          <div>
            <div class="caps">{groupOf(tool)?.label ?? "Tool"}</div>
            <h2 class="h">{label(tool)}</h2>
            <div class="mono faint tiny">{tool}</div>
          </div>
          <span class="spacer"></span>
          {#if result}<span class="tiny faint">{result.cached ? "from cache" : "live"} · {agoText(result.fetched_at_ms, now.value)}</span>{/if}
        </div>
        {#if current?.description}
          <p class="muted small" style="margin:10px 0 0; white-space: pre-line">{current.description.trim()}</p>
        {:else if !catalog.length}
          <p class="faint small">The server's description loads with the tool list.</p>
        {/if}

        <form onsubmit={run} class="form">
          {#each Object.entries(schema) as [key, s] (key)}
            <div class="field">
              <label for="f-{key}">{key}{required.has(key) ? " *" : ""} <span class="faint">{Array.isArray(s.type) ? s.type.join("|") : (s.type ?? "")}</span></label>
              {#if s.enum?.length}
                <select id="f-{key}" class="input" bind:value={args[key]}>
                  {#each s.enum as opt (String(opt))}<option value={String(opt)}>{String(opt)}</option>{/each}
                </select>
              {:else if (Array.isArray(s.type) ? s.type : [s.type]).includes("boolean")}
                <select id="f-{key}" class="input" bind:value={args[key]}>
                  <option value="">(default)</option><option value="true">true</option><option value="false">false</option>
                </select>
              {:else}
                <input id="f-{key}" class="input" bind:value={args[key]} placeholder={s.default !== undefined ? String(s.default) : ""} />
              {/if}
              {#if s.description}<div class="hint">{s.description}</div>{/if}
            </div>
          {/each}
          {#if Object.keys(schema).length === 0}<div class="faint small">This tool takes no arguments.</div>{/if}
          <div class="actions">
            <button class="btn primary" type="submit" disabled={running}>{running ? "Asking Skywalker…" : "Run read-only call"}</button>
            <span class="tiny faint">Calls are read-only and cached for a short time.</span>
          </div>
        </form>
      </div>

      {#if runErr}
        <div class="notice error" style="margin-top:14px" role="alert">{describeError(runErr)}</div>
      {/if}

      {#if result}
        <div class="card" style="margin-top:14px">
          <div class="head">
            <h3 class="h3">Result</h3>
            <span class="spacer"></span>
            <div class="seg">
              <button class:on={!raw} onclick={() => (raw = false)}>Readable</button>
              <button class:on={raw} onclick={() => (raw = true)}>Raw JSON</button>
            </div>
          </div>
          {#if raw}
            <pre class="json">{JSON.stringify(result.data, null, 2)}</pre>
          {:else}
            {@const top = entries(result.data)}
            <div class="readable">
              {#if top.length === 0}
                <pre class="json">{JSON.stringify(result.data, null, 2)}</pre>
              {:else}
                {#each top as [k, v] (k)}
                  {#if isScalar(v)}
                    <div class="kv"><span class="k">{k}</span><span class="v num">{fmtScalar(k, v)}</span></div>
                  {:else if Array.isArray(v)}
                    <Section title={k.replaceAll("_", " ")} sub="{v.length} item{v.length === 1 ? "" : "s"}" empty={v.length === 0} emptyText="None.">
                      {#if v.length && typeof v[0] === "object" && v[0] !== null}
                        <Table rows={v as Record<string, unknown>[]} cols={Object.keys(v[0] as object).slice(0, 8).map((c) => ({ key: c, label: c.replaceAll("_", " "), value: (r: Record<string, unknown>) => (isScalar(r[c]) ? (r[c] as string | number | null) : JSON.stringify(r[c])) }))} max={200} />
                      {:else}
                        <div class="chips">{#each v as x (String(x))}<span class="pill mono">{String(x)}</span>{/each}</div>
                      {/if}
                    </Section>
                  {:else if typeof v === "object"}
                    <Section title={k.replaceAll("_", " ")}>
                      <div class="readable">
                        {#each entries(v) as [k2, v2] (k2)}
                          {#if isScalar(v2)}<div class="kv"><span class="k">{k2}</span><span class="v num">{fmtScalar(k2, v2)}</span></div>{:else}<div class="kv"><span class="k">{k2}</span><span class="v mono tiny">{JSON.stringify(v2).slice(0, 240)}</span></div>{/if}
                        {/each}
                      </div>
                    </Section>
                  {/if}
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    {/if}
  </section>
</div>

<style>
  .explorer { display: grid; grid-template-columns: 240px 1fr; gap: 16px; align-items: start; }
  .tool-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
  .tool-card { display: grid; gap: 4px; text-align: left; padding: 12px; border-radius: 12px; background: var(--surface); border: 1px solid var(--stroke); color: inherit; }
  .tool-card:hover { background: var(--surface-2); border-color: var(--accent); }
  .tool-name { font-size: 14px; font-weight: 600; }
  .tool-desc { font-size: 12.5px; color: var(--text-2); line-height: 1.4; }
  @media (max-width: 1100px) { .tool-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .list { position: sticky; top: 0; max-height: calc(100vh - 150px); overflow: auto; padding: 12px; }
  .grp { margin: 14px 4px 6px; }
  .item span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item { display: flex; justify-content: space-between; align-items: center; gap: 8px; width: 100%; text-align: left; background: transparent; border: 0; padding: 7px 9px; border-radius: 9px; color: var(--text-2); }
  .item:hover { background: var(--surface-2); color: var(--text); }
  /* Review item 10: the slug column hides in a narrow list so the tool name is not truncated. It stays on hover. */
  .list { container-type: inline-size; }
  @container (max-width: 279px) { .slug { display: none; } }
  .item.on { background: var(--surface-2); color: var(--text); box-shadow: inset 0 0 0 1px var(--stroke-2); }
  .head { display: flex; align-items: flex-start; gap: 12px; }
  .h { margin: 2px 0 0; font-size: 20px; letter-spacing: -0.01em; }
  .h3 { margin: 0; font-size: 14px; }
  .form { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px 14px; margin-top: 16px; }
  .form .actions { grid-column: 1 / -1; display: flex; align-items: center; gap: 12px; }
  .readable { display: grid; gap: 8px; }
  .kv { display: grid; grid-template-columns: minmax(160px, 260px) 1fr; gap: 12px; padding: 7px 4px; border-bottom: 1px solid var(--stroke); }
  .kv .k { color: var(--text-2); font-size: 13px; }
  .kv .v { word-break: break-word; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  @media (max-width: 1000px) { .explorer { grid-template-columns: 1fr; } .list { position: static; max-height: none; } }
</style>
