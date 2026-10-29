<script lang="ts">
  import { onMount } from "svelte";
  import { session } from "../lib/signin.svelte";
  import { bridge, type Settings } from "../lib/api";
  import { applyTheme, type Theme } from "../lib/theme";
  import { DEFAULT_SERVER_URL } from "../lib/constants";
  import { shortTime } from "../lib/format";
  import Section from "../components/Section.svelte";
  import { callOnce } from "../lib/query.svelte";
  import { describeError, type AppError } from "../lib/api";

  // Identity from Skywalker itself (skywalker_whoami), not only from the /whoami path.
  interface Whoami { email?: string; role?: string; google_token_ok?: boolean; google_problem?: string | null; tools_version?: string; billing_export?: boolean; project_rule?: string; fleet_scopes?: string[]; }
  let who = $state<Whoami | null>(null);
  let whoErr = $state<AppError | null>(null);
  $effect(() => {
    if (__DEMO__) {
      who = { email: "pi@example.edu (DEMO)", role: "staff", google_token_ok: true, project_rule: "DEMO fixture" };
      return;
    }
    void callOnce<Whoami>("skywalker_whoami", {}, 600)
      .then((r) => { who = r.data; whoErr = null; })
      .catch((e) => { whoErr = e as AppError; });
  });
  const isStaff = $derived(who?.role === "staff" || who?.role === "admin");

  let draft = $state<Settings>({ server_url: DEFAULT_SERVER_URL, theme: "dark", refresh_minutes: 5, client_id: null });
  let saved = $state<string | null>(null);
  let dirs = $state<string>("");

  onMount(async () => {
    if (session.status) {
      draft = { ...session.status.settings };
    }
    try {
      dirs = await bridge.appDirs();
    } catch {
      dirs = "";
    }
  });

  async function save() {
    saved = null;
    const next = { ...draft, refresh_minutes: Math.min(60, Math.max(5, Number(draft.refresh_minutes) || 5)) };
    await session.save(next);
    draft = { ...next };
    applyTheme(next.theme as Theme);
    saved = session.error ? null : "Saved.";
  }

  async function setTheme(t: Theme) {
    draft.theme = t;
    applyTheme(t);
    // Persist the theme now, with only the theme changed (the URL and interval stay as saved).
    if (session.status) await session.save({ ...session.status.settings, theme: t });
  }

  async function out() {
    await session.signOut();
  }

  const expires = $derived(session.status?.expires_at ? new Date(session.status.expires_at * 1000).toISOString() : null);
</script>

<div class="grid g2">
  <Section title="Account" sub="who Skywalker sees you as">
    <div class="kv"><span class="k">Signed in as</span><span class="v">{who?.email ?? session.status?.email ?? "--"}</span></div>
    <div class="kv"><span class="k">Skywalker role</span><span class="v">{who?.role ?? "--"}{who ? (isStaff ? " (staff: fleet and billing views on)" : " (project views only)") : ""}</span></div>
    <div class="kv"><span class="k">Google token held by Skywalker</span><span class="v">{who ? (who.google_token_ok ? "yes" : `no${who.google_problem ? `: ${who.google_problem}` : ""}`) : "--"}</span></div>
    <div class="kv"><span class="k">Project rule</span><span class="v">{who?.project_rule ?? "--"}</span></div>
    <div class="kv"><span class="k">Billing export</span><span class="v">{who ? (who.billing_export ? "connected" : "not configured on the server") : "--"}</span></div>
    {#if whoErr}<div class="notice error" role="alert" style="margin-top:8px">{describeError(whoErr)}</div>{/if}
    <div class="kv"><span class="k">Access token renews</span><span class="v">{shortTime(expires)}</span></div>
    <div class="kv"><span class="k">Granted scope</span><span class="v mono tiny">{session.status?.scope ?? "--"}</span></div>
    <div class="kv"><span class="k">Build</span><span class="v">{__DEMO__ ? "DEMO (fixtures)" : "release"}</span></div>
    <div class="actions">
      <button class="btn danger" onclick={out} disabled={session.busy}>Sign out and revoke</button>
      <span class="tiny faint">Revokes your refresh token on the server and deletes it from the Keychain.</span>
    </div>
    {#if session.notice}<div class="notice" style="margin-top:12px">{session.notice}</div>{/if}
  </Section>

  <div class="stack">
  <Section title="Connection" sub="Skywalker MCP server">
    <div class="field">
      <label for="srv">Server URL</label>
      {#if __DEMO__}
        <input id="srv" class="input mono" value={DEFAULT_SERVER_URL} disabled aria-describedby="srv-hint" />
        <div class="hint" id="srv-hint"><span class="pill warn">DEMO</span> Fixtures are used; this URL is the real default and is not called in DEMO.</div>
      {:else}
        <input id="srv" class="input" bind:value={draft.server_url} spellcheck="false" />
        <div class="hint">https only. Default: {DEFAULT_SERVER_URL}</div>
      {/if}
    </div>
    <div class="field" style="margin-top:12px">
      <label for="ref">Refresh the open page every</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="ref" type="number" min="5" max="60" class="input" style="width:90px" bind:value={draft.refresh_minutes} disabled={__DEMO__} />
        <span class="muted">minutes (5 to 60; the server is never asked more often)</span>
      </div>
    </div>
    <div class="actions">
      <button class="btn primary" onclick={save} disabled={__DEMO__}>Save</button>
      {#if saved}<span class="pill good">{saved}</span>{/if}
      {#if session.error}<span class="pill alert">{session.error.message}</span>{/if}
    </div>
  </Section>

  <Section title="Appearance" sub="">
    <div class="field">
      <span class="lbl">Theme</span>
      <div class="seg" role="group" aria-label="Theme">
        <button class:on={draft.theme === "dark"} onclick={() => setTheme("dark")}>Dark</button>
        <button class:on={draft.theme === "light"} onclick={() => setTheme("light")}>Light</button>
        <button class:on={draft.theme === "system"} onclick={() => setTheme("system")}>System</button>
      </div>
    </div>
  </Section>
  </div>


  <Section title="About the data" sub="what you can rely on" span={2}>
    <ul class="about">
      <li>Every number comes from Skywalker. A missing value shows as <span class="mono">--</span>; nothing is estimated or filled in.</li>
      <li>Telescope only reads. It never changes anything in Google Cloud, and it never sees your Google password.</li>
      <li>Money is gross (usage at list price, before PSSA credits) unless a label says net. Each budget counts the basis Skywalker reports for it (gross or net); the Basis column shows which.</li>
      <li>Results are cached in memory for a few minutes, with "updated N min ago" on each section. Nothing is written to disk except settings.</li>
      <li>Config folder: <span class="mono tiny">{__DEMO__ ? "DEMO: ~/Library/Application Support/telescope" : dirs || "--"}</span></li>
    </ul>
  </Section>
</div>

<style>
  .stack { display: grid; gap: 14px; align-content: start; }
  .kv { display: grid; grid-template-columns: 170px 1fr; gap: 12px; padding: 8px 2px; border-bottom: 1px solid var(--stroke); font-size: 13px; }
  .kv .k { color: var(--text-2); }
  .kv .v { word-break: break-all; }
  .actions { display: flex; align-items: center; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field label, .lbl { font-size: 12px; color: var(--text-2); }
  .hint { font-size: 11.5px; color: var(--text-3); }
  .about { margin: 0; padding-left: 18px; display: grid; gap: 8px; color: var(--text-2); font-size: 13px; }
</style>
