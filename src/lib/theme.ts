// Theme: dark-first, light available, or follow the system. Applied as a data
// attribute on <html>, so CSS variables do the rest.
export type Theme = "dark" | "light" | "system";

export function applyTheme(t: Theme): void {
  const dark =
    t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
