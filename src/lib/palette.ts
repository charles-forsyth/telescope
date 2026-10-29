// Chart and status colours. Kept in one place so every chart agrees.
export const C = {
  accent: "#6aa8ff",
  accent2: "#9d7bff",
  good: "#3ddc97",
  warn: "#f5b544",
  hot: "#ff7a45",
  alert: "#ff5577",
  muted: "#8b949e",
  grid: "rgba(160,170,190,0.12)",
};

// Project identity colours (item 10): blues, purples, teals, ambers, pinks. No pure red or green,
// which read as health status. Status keeps C.good / C.alert.
export const SERIES = ["#6aa8ff", "#9d7bff", "#4fd1d9", "#f5b544", "#c792ea", "#82aaff", "#e0a96d", "#7fb8ff", "#b28dff", "#5ec7d6", "#f2c46d", "#a7b4ff"];

export function heatColor(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return C.muted;
  if (p >= 100) return C.alert;
  if (p >= 90) return C.hot;
  if (p >= 75) return C.warn;
  return C.good;
}
