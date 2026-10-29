<script lang="ts">
  // ECharts wrapper: themed, resized with its container, disposed on unmount.
  import { onDestroy, onMount } from "svelte";
  // Only the chart types and components the pages use (bar, line, treemap). Tree-shaken
  // from echarts/core so the bundle carries no unused chart code.
  import * as echarts from "echarts/core";
  import { BarChart, LineChart, TreemapChart } from "echarts/charts";
  import { GridComponent, TooltipComponent, LegendComponent, MarkPointComponent } from "echarts/components";
  import { CanvasRenderer } from "echarts/renderers";

  echarts.use([BarChart, LineChart, TreemapChart, GridComponent, TooltipComponent, LegendComponent, MarkPointComponent, CanvasRenderer]);

  interface Props {
    option: echarts.EChartsCoreOption;
    height?: string;
    label?: string;
    class?: string;
  }
  let { option, height = "240px", label = "chart", class: cls = "" }: Props = $props();

  let el: HTMLDivElement | undefined = $state();
  let chart: echarts.ECharts | null = null;
  let ro: ResizeObserver | null = null;
  let theme = $state(typeof document !== "undefined" ? document.documentElement.dataset.theme ?? "dark" : "dark");
  let mo: MutationObserver | null = null;

  function palette() {
    const dark = theme !== "light";
    return {
      text: dark ? "#aab1c2" : "#4a5468",
      muted: dark ? "#8b949e" : "#57606a",
      grid: dark ? "rgba(160,170,190,0.12)" : "rgba(20,28,45,0.08)",
      tip: dark ? "rgba(18,22,31,0.94)" : "rgba(255,255,255,0.96)",
      tipText: dark ? "#e8ebf2" : "#141a26",
    };
  }

  function render() {
    if (!chart) return;
    const p = palette();
    const base: echarts.EChartsCoreOption = {
      animationDuration: 500,
      animationDurationUpdate: 300,
      animationEasing: "cubicOut",
      textStyle: { fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif", color: p.text },
      tooltip: {
        backgroundColor: p.tip,
        borderColor: "rgba(127,127,127,0.2)",
        textStyle: { color: p.tipText, fontSize: 12 },
        extraCssText: "backdrop-filter: blur(12px); border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.25);",
      },
    };
    chart.setOption({ ...base, ...(option as object) }, { notMerge: false, replaceMerge: ["series", "xAxis", "yAxis", "legend", "grid"], lazyUpdate: true });
  }

  onMount(() => {
    if (!el) return;
    chart = echarts.init(el, undefined, { renderer: "canvas" });
    chart.group = "telescope";
    render();
    ro = new ResizeObserver(() => chart?.resize());
    ro.observe(el);
    mo = new MutationObserver(() => {
      theme = document.documentElement.dataset.theme ?? "dark";
      render();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  });

  $effect(() => {
    // Re-render when the option object changes. Merge (not notMerge) so 7 sequential
    // Billing updates animate in place instead of restarting the grow animation each time.
    void option;
    render();
  });

  onDestroy(() => {
    ro?.disconnect();
    mo?.disconnect();
    chart?.dispose();
    chart = null;
  });
</script>

<div bind:this={el} class="chart {cls}" style="height:{height}" role="img" aria-label={label}></div>
