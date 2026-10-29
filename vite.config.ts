import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Demo fixtures are compiled in only when TELESCOPE_DEMO=1 (QA builds). Release
// builds set __DEMO__ to false, so the fixture code is dead-code eliminated.
const demo = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.TELESCOPE_DEMO === "1";

export default defineConfig({
  plugins: [svelte()],
  define: { __DEMO__: JSON.stringify(demo) },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
    target: "safari15",
    chunkSizeWarningLimit: 1200,
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
