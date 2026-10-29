<script lang="ts">
  // Cmd-K: jump to a project, a tool, or a page. Keyboard first.
  import { onMount } from "svelte";
  import { ALL_TOOLS, TOOL_LABEL } from "../lib/tools";
  import { callOnce } from "../lib/query.svelte";

  interface Props {
    projects: string[];
    onClose: () => void;
    onPick: (kind: "project" | "tool" | "page" | "focus", value: string) => void;
  }
  let { projects, onClose, onPick }: Props = $props();

  let q = $state("");
  let sel = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();
  let remote = $state<string[]>([]);

  const pages = [
    { kind: "page" as const, value: "fleet", label: "Fleet overview" },
    { kind: "page" as const, value: "budgets", label: "Budgets" },
    { kind: "page" as const, value: "settings", label: "Settings" },
  ];

  // Look up projects by name through Skywalker when the local list is short.
  let lookup: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const text = q.trim();
    if (lookup) clearTimeout(lookup);
    if (text.length < 3) {
      remote = [];
      return;
    }
    lookup = setTimeout(async () => {
      try {
        const r = await callOnce<{ projects?: { project_id: string }[] }>("skywalker_projects", { query: text, limit: 25 }, 120);
        remote = (r.data.projects ?? []).map((p) => p.project_id);
      } catch {
        remote = [];
      }
    }, 280);
  });

  const items = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    const match = (s: string) => !needle || s.toLowerCase().includes(needle);
    const projs = [...new Set([...projects, ...remote])].filter(match).slice(0, 12);
    const tools = ALL_TOOLS.filter((t) => match(t) || match(TOOL_LABEL[t] ?? "")).slice(0, 10);
    const pg = pages.filter((p) => match(p.label));
    // Focus is a server-side default-context setting (not a Google change). Offered for the top project match.
    const focusAction = projs.length && needle ? [{ kind: "focus" as const, value: projs[0], label: `Set Skywalker focus to ${projs[0]}`, hint: "sets your default project on the server" }] : [];
    return [
      ...focusAction,
      ...projs.map((v) => ({ kind: "project" as const, value: v, label: v, hint: "project" })),
      ...pg.map((p) => ({ kind: p.kind, value: p.value, label: p.label, hint: "page" })),
      ...tools.map((t) => ({ kind: "tool" as const, value: t, label: TOOL_LABEL[t] ?? t, hint: t })),
    ];
  });

  $effect(() => {
    void items;
    sel = 0;
  });

  function key(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); }
    else if (e.key === "Enter" && items[sel]) onPick(items[sel].kind, items[sel].value);
  }

  onMount(() => inputEl?.focus());
</script>

<div class="scrim" role="presentation" onclick={onClose} onkeydown={key}>
  <div class="palette" role="dialog" aria-label="Search" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={key}>
    <input bind:this={inputEl} bind:value={q} placeholder="Jump to a project, tool or page…" aria-label="Search" />
    <div class="list">
      {#each items as it, i (it.kind + it.value)}
        <div class="opt {i === sel ? 'sel' : ''}" role="option" aria-selected={i === sel} tabindex="-1"
             onmouseenter={() => (sel = i)} onclick={() => onPick(it.kind, it.value)} onkeydown={() => {}}>
          <span class="pill info">{it.kind}</span>
          <span class="mono" style="font-size:13px">{it.label}</span>
          <span class="kind">{it.hint}</span>
        </div>
      {:else}
        <div class="empty">No match. Try a project id such as demo-lab-…</div>
      {/each}
    </div>
  </div>
</div>
