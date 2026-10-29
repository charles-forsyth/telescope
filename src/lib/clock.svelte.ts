// A shared clock so "updated N min ago" labels tick without each widget polling.
export const now = $state({ value: Date.now() });

if (typeof window !== "undefined") {
  setInterval(() => {
    now.value = Date.now();
  }, 15_000);
}
