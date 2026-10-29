<script lang="ts">
  import type { Insight } from "../lib/insights";
  interface Props {
    items: Insight[];
    limit?: number;
    empty?: string;
  }
  let { items, limit = 99, empty = "No notable findings. Nothing alarming in what Skywalker returned." }: Props = $props();
  const shown = $derived(items.slice(0, limit));
  // The rise animation plays once, on first mount. Later updates must not restart it,
  // or a changed sentence fades in from transparent (review item 12).
  let mounted = $state(false);
  $effect(() => {
    if (shown.length) mounted = true;
  });
</script>

{#if shown.length === 0}
  <div class="empty">{empty}</div>
{:else}
  <div class="insights">
    {#each shown as i, idx (`${i.area}:${i.level}:${idx}`)}
      <div class="insight {i.level}" style={mounted ? "" : `animation-delay:${idx * 40}ms`}>
        <span class="bar"></span>
        <div>
          <div class="area">{i.area}</div>
          <div>{i.text}</div>
        </div>
      </div>
    {/each}
  </div>
{/if}
