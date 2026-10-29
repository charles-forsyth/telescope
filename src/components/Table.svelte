<script module lang="ts">
  import type { Snippet } from "svelte";
  export interface Col<R> {
    key: string;
    label: string;
    value: (r: R) => number | string | null | undefined;
    align?: "l" | "r";
    cell?: Snippet<[R]>;
    fmt?: (r: R) => string;
    wrap?: boolean;
    /** Optional faint second line under the value (e.g. a budget name under a project id). */
    sub?: (r: R) => string | null | undefined;
    /** Keep the cell on one line (numbers). */
    nowrap?: boolean;
    /** Render the value as a small pill: "muted" | "accent" | "none" (item 9, Budgets basis). */
    pill?: (r: R) => "muted" | "accent" | "none" | null;
  }
</script>

<script lang="ts" generics="T extends Record<string, unknown>">
  // Sortable table. Columns define how to read and render each cell.
  interface Props {
    rows: T[];
    cols: Col<T>[];
    sortKey?: string;
    sortDir?: "asc" | "desc";
    onRow?: (r: T) => void;
    rowKey?: (r: T, i: number) => string;
    max?: number;
    cellSnippet?: Snippet<[T, string]>;
  }
  let { rows, cols, sortKey = $bindable(""), sortDir = $bindable("desc"), onRow, rowKey, max = 500 }: Props = $props();

  function toggle(k: string) {
    if (sortKey === k) sortDir = sortDir === "asc" ? "desc" : "asc";
    else {
      sortKey = k;
      sortDir = "desc";
    }
  }

  const sorted = $derived.by(() => {
    const col = cols.find((c) => c.key === sortKey);
    if (!col) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  });
  const shown = $derived(sorted.slice(0, max));
</script>

<div class="table-wrap">
  <table>
    <thead>
      <tr>
        {#each cols as c (c.key)}
          <th class="{c.align === 'r' ? 'r' : ''} sortable" onclick={() => toggle(c.key)} aria-sort={sortKey === c.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
            {c.label}{sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each shown as r, i (rowKey ? rowKey(r, i) : i)}
        <tr class={onRow ? "click" : ""} onclick={() => onRow?.(r)}>
          {#each cols as c (c.key)}
            <td class="{c.align === 'r' ? 'r num' : ''} {c.wrap ? 'wrap' : ''} {c.nowrap ? 'nowrap' : ''}">
              {#if c.cell}{@render c.cell(r)}{:else if c.pill && c.pill(r)}<span class="pill basis {c.pill(r)}">{c.fmt ? c.fmt(r) : c.value(r)}</span>{:else if c.fmt}{c.fmt(r)}{:else}{c.value(r) ?? "--"}{/if}
              {#if c.sub && c.sub(r)}<div class="tiny faint">{c.sub(r)}</div>{/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>
{#if rows.length > max}<div class="tiny faint" style="margin-top:6px">Showing {max} of {rows.length}.</div>{/if}
