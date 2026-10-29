<script lang="ts">
  import { onMount } from "svelte";
  import type { Settings } from "../lib/api";
  import { session } from "../lib/signin.svelte";
  import { router } from "../lib/router.svelte";
  import { applyTheme } from "../lib/theme";
  import { ALL_TOOLS, TOOL_LABEL } from "../lib/tools";
  import { callOnce } from "../lib/query.svelte";
  import { asAppError } from "../lib/api";
  import Palette from "./Palette.svelte";
  import Fleet from "../pages/Fleet.svelte";
  import Project from "../pages/Project.svelte";
  import Budgets from "../pages/Budgets.svelte";
  import Billing from "../pages/Billing.svelte";
  // The explorer is rarely opened: it loads on demand, out of the first bundle.
  // Loaded once, on first visit to the explorer.
  let toolsPromise: Promise<typeof import("../pages/Tools.svelte")> | null = null;
  const loadTools = () => (toolsPromise ??= import("../pages/Tools.svelte"));
  import SettingsPage from "../pages/Settings.svelte";
  import SignIn from "./SignIn.svelte";

  let paletteOpen = $state(false);
  let focusNote = $state<string | null>(null);
  let projects = $state<string[]>([]);
  let fleetStamp = $state<number | null>(null);

  const signedIn = $derived(session.status?.signed_in ?? false);
  const r = $derived(router.current);

  onMount(async () => {
    await session.load();
    const s = session.status?.settings;
    if (s) applyTheme(s.theme as Settings["theme"]);
    window.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        paletteOpen = !paletteOpen;
      }
    });
  });

  function title(): { crumb: string; title: string } {
    switch (r.name) {
      case "fleet": return { crumb: "Ursa Major", title: "Fleet" };
      case "project": return { crumb: "Projects", title: r.id || "Project" };
      case "budgets": return { crumb: "Ursa Major", title: "Budgets" };
      case "billing": return { crumb: "Ursa Major", title: "Billing & PSSA" };
      case "tools": return { crumb: "Explorer", title: r.tool ? (TOOL_LABEL[r.tool] ?? r.tool) : "All tools" };
      case "settings": return { crumb: "App", title: "Settings" };
    }
  }
  const t = $derived(title());

  function navActive(name: string): boolean {
    return r.name === name;
  }

  async function onPick(kind: "project" | "tool" | "page" | "focus", value: string) {
    paletteOpen = false;
    if (kind === "focus") {
      // Explicit user action: ask Skywalker to set the default project for this user.
      try {
        await callOnce("skywalker_focus", { project_id: value }, 0);
        focusNote = `Skywalker focus set to ${value}. This is a server-side default for your tools; nothing in Google Cloud changed.`;
      } catch (e) {
        focusNote = `Could not set focus: ${asAppError(e).message}`;
      }
      return;
    }
    if (kind === "project") router.go(`#/project/${encodeURIComponent(value)}/spend`);
    else if (kind === "tool") router.go(`#/tools/${encodeURIComponent(value)}`);
    else router.go(`#/${value}`);
  }

  export function setProjects(list: string[]) {
    projects = list;
  }
  export { fleetStamp };
</script>

<svelte:head>
  <title>Telescope</title>
</svelte:head>

{#if __DEMO__}
  <div class="demo-band" aria-label="Demo build">DEMO DATA · NOT LIVE · LOCAL QA BUILD</div>
{/if}

{#if !signedIn}
  <SignIn />
{:else}
  <div class="frame" style={__DEMO__ ? "padding-top:22px" : ""}>
    <aside class="side">
      <div class="brand">
        <img src="/app-icon.png" alt="" width="30" height="30" />
        <div>
          <div class="brand-name">Telescope</div>
          <div class="brand-sub">Ursa Major · read-only</div>
        </div>
      </div>

      <button class="nav-item {navActive('fleet') ? 'active' : ''}" onclick={() => router.go("#/fleet")}>
        <span class="ico">◎</span> Fleet
      </button>
      <button class="nav-item {navActive('budgets') ? 'active' : ''}" onclick={() => router.go("#/budgets")}>
        <span class="ico">◔</span> Budgets
      </button>
      <button class="nav-item {navActive('billing') ? 'active' : ''}" onclick={() => router.go("#/billing")}>
        <span class="ico">◈</span> Billing &amp; PSSA
      </button>
      <button class="nav-item {navActive('project') ? 'active' : ''}" onclick={() => { paletteOpen = true; }}>
        <span class="ico">▣</span> Projects
      </button>

      <div class="caps nav-label">Explore</div>
      <button class="nav-item {navActive('tools') ? 'active' : ''}" onclick={() => router.go("#/tools")}>
        <span class="ico">⌥</span> All tools
        <span class="count">{ALL_TOOLS.length}</span>
      </button>

      <div class="side-foot">
        <button class="nav-item {navActive('settings') ? 'active' : ''}" onclick={() => router.go("#/settings")}>
          <span class="ico">⚙</span> Settings
        </button>
        <div class="who">
          <span class="dot ok"></span>
          <span class="mono" style="font-size:11.5px;overflow:hidden;text-overflow:ellipsis">{session.status?.email ?? "signed in"}</span>
        </div>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="crumbs">
          <span>{t.crumb}</span>
          <span class="faint">/</span>
          <b>{t.title}</b>
        </div>
        <span class="spacer"></span>
        <button class="btn small" onclick={() => { paletteOpen = true; }} aria-label="Search and jump">
          Search <span class="faint">⌘K</span>
        </button>
      </header>

      {#if focusNote}<div class="notice" style="margin-bottom:12px" role="status"><span>{focusNote}</span> <button class="btn small" onclick={() => (focusNote = null)}>Dismiss</button></div>{/if}
      <main class="content">
        {#if r.name === "fleet"}
          <Fleet />
        {:else if r.name === "project"}
          <Project id={r.id} tab={r.tab} />
        {:else if r.name === "budgets"}
          <Budgets />
        {:else if r.name === "billing"}
          <Billing />
        {:else if r.name === "tools"}
          {#await loadTools() then mod}
            <mod.default tool={r.tool} />
          {/await}
        {:else if r.name === "settings"}
          <SettingsPage />
        {/if}
      </main>
    </div>
  </div>

  {#if paletteOpen}
    <Palette projects={projects} onClose={() => (paletteOpen = false)} onPick={onPick} />
  {/if}
{/if}
