<script lang="ts">
  // Shared-scale bar. `scaleMax` is the largest of 100 and every value in the list, so an
  // overflow past 100% shows as a longer bar, with a fixed tick at 100%.
  interface Props {
    value: number | null | undefined;
    scaleMax?: number;
    fill?: string;
    label?: string;
  }
  import { heatColor } from "../lib/palette";
  let { value, scaleMax = 100, fill, label = "" }: Props = $props();
  const ok = $derived(value !== null && value !== undefined && Number.isFinite(value));
  const width = $derived(ok ? Math.max(0, ((value as number) / scaleMax) * 100) : 0);
  const color = $derived(fill ?? heatColor(ok ? (value as number) : null));
  const tickAt = $derived((100 / scaleMax) * 100);
</script>

<div class="bullet" role="meter" aria-valuenow={ok ? (value as number) : undefined} aria-valuemin={0} aria-valuemax={scaleMax} aria-label={label || undefined}>
  <div class="track">
    <span class="fill" style="width:{Math.min(100, width)}%;background:{color};box-shadow:0 0 10px {color}55"></span>
    {#if width > 100}<span class="over" style="background:{color}"></span>{/if}
    <span class="tick" style="left:{tickAt}%" title="100%"></span>
  </div>
  {#if label}<div class="tiny faint" style="margin-top:4px">{label}</div>{/if}
</div>

<style>
  .bullet { width: 100%; }
  .track { position: relative; height: 10px; border-radius: 5px; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--stroke); }
  .fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 5px; transition: width 0.4s var(--ease); }
  .over { position: absolute; right: -6px; top: -3px; width: 6px; height: 16px; border-radius: 3px; }
  .tick { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--text-2); border-radius: 1px; }
</style>
