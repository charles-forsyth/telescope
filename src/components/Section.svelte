<script lang="ts">
  // A card that handles loading, error and empty states for one data source.
  import type { Snippet } from "svelte";
  import { describeError, type AppError } from "../lib/api";

  interface Props {
    title: string;
    sub?: string;
    loading?: boolean;
    error?: AppError | null;
    empty?: boolean;
    emptyText?: string;
    ago?: string;
    span?: number;
    children?: Snippet;
    actions?: Snippet;
  }
  let {
    title,
    sub = "",
    loading = false,
    error = null,
    empty = false,
    emptyText = "Nothing to show yet.",
    ago = "",
    span = 1,
    children,
    actions,
  }: Props = $props();
</script>

<section class="card" style={span > 1 ? `grid-column: span ${span}` : ""}>
  <div class="card-head">
    <h3>{title}</h3>
    {#if sub}<span class="sub"><span class="sep" aria-hidden="true"> · </span>{sub}</span>{/if}
    <span class="spacer"></span>
    {#if ago && !loading}<span class="tiny faint">{ago}</span>{/if}
    {#if actions}{@render actions()}{/if}
  </div>

  {#if error && !(loading && !error)}
    <div class="notice error" role="alert">
      <span>{describeError(error)}</span>
    </div>
    {#if children && !empty}
      <div style="margin-top:12px">{@render children()}</div>
    {/if}
  {:else if loading && empty}
    <div class="skeleton" style="width:70%"></div>
    <div class="skeleton" style="width:90%;margin-top:9px"></div>
    <div class="skeleton" style="width:55%;margin-top:9px"></div>
  {:else if empty}
    <div class="empty">{emptyText}</div>
  {:else if children}
    {@render children()}
  {/if}
</section>
