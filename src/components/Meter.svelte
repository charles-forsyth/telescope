<script lang="ts">
  import { heatColor } from "../lib/palette";
  import { pct as fmtPct } from "../lib/format";
  interface Props {
    value: number | null | undefined;
    max?: number;
    tall?: boolean;
    color?: string;
    label?: boolean;
  }
  let { value, max = 100, tall = false, color, label = false }: Props = $props();
  const ratio = $derived(value === null || value === undefined || !Number.isFinite(value) ? 0 : Math.min(100, (value / max) * 100));
  const fill = $derived(color ?? heatColor(value === null || value === undefined ? null : (value / max) * 100));
</script>

<div class="meter {tall ? 'tall' : ''}" role="meter" aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={max}>
  <span style="width:{ratio}%;background:{fill};box-shadow:0 0 12px {fill}55"></span>
</div>
{#if label}<div class="tiny faint" style="margin-top:4px">{fmtPct(value === null || value === undefined ? null : value)}</div>{/if}
