import { describe, expect, it } from "vitest";

// P0 regression (ADDENDUM): Telescope opened a Google sign-in without a click. These tests pin the
// fix in source: sign-in starts only from a deliberate second click, never on load, mount, focus or
// refresh, and the test suite itself never reaches the bridge.
//
// Frontend sources come from src/ via import.meta.glob. Rust and capability files live outside src/,
// so they are read with ?raw imports from their relative paths.
import commandsRs from "../../src-tauri/src/commands.rs?raw";
import clientRs from "../../src-tauri/src/client.rs?raw";
import capabilities from "../../src-tauri/capabilities/default.json?raw";

const RAW = import.meta.glob("../**/*.{ts,svelte}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const page = (suffix: string) => {
  const hit = Object.entries(RAW).find(([k]) => k.endsWith(suffix));
  if (!hit) throw new Error(`missing ${suffix}`);
  return hit[1];
};
const noComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");

describe("P0: sign-in starts only from the Sign in button", () => {
  it("the browser opener is used only inside the gated sign_in command", () => {
    expect(commandsRs).toContain("open_url(url, None::<&str>)");
    const statusFn = commandsRs.slice(commandsRs.indexOf("pub async fn app_status"), commandsRs.indexOf("pub async fn begin_sign_in"));
    expect(statusFn).not.toContain("opener");
    expect(statusFn).not.toContain("sign_in(");
  });

  it("the refresh path never falls back to a full authorize", () => {
    const refresh = clientRs.slice(clientRs.indexOf("async fn refresh("), clientRs.indexOf("/// Drop tokens and cached results"));
    expect(refresh.length).toBeGreaterThan(200);
    expect(refresh).not.toContain("authorize_url");
    expect(refresh).not.toContain("open_url");
    expect(refresh).not.toContain("sign_in(");
  });

  it("the Keychain read at startup never authorizes (no browser)", () => {
    const load = clientRs.slice(clientRs.indexOf("pub async fn load_tokens"), clientRs.indexOf("pub async fn status"));
    expect(load.length).toBeGreaterThan(20);
    expect(load).not.toContain("authorize");
    expect(load).not.toContain("open_url");
  });

  it("the sign-in bridge is called only from the session store, and the panel reaches it only through the second click", () => {
    // The bridge is invoked only inside src/lib/signin.svelte.ts (and defined in api.ts). The panel never
    // touches the bridge: it calls session.signIn(), which is reachable only from onConfirm.
    const hits = Object.entries(RAW)
      .filter(([k]) => !k.endsWith(".test.ts"))
      .filter(([, v]) => /bridge\.signIn\(|bridge\.beginSignIn\(|"sign_in"/.test(noComments(v)))
      .map(([k]) => k.split("/").slice(-1)[0])
      .sort();
    expect(hits).toEqual(["api.ts", "signin.svelte.ts"]);
    const panel = noComments(page("components/SignIn.svelte"));
    expect(panel).not.toContain("bridge.");
    const onConfirm = panel.slice(panel.indexOf("function onConfirm"), panel.indexOf("function onCancel"));
    expect(onConfirm).toContain("session.signIn()");
  });

  it("the sign-in panel never calls sign-in from a timer, an effect or mount", () => {
    const panel = noComments(page("components/SignIn.svelte"));
    expect(panel).not.toMatch(/\$effect\(/);
    expect(panel).not.toMatch(/setTimeout|setInterval/);
    const mount = panel.slice(panel.indexOf("onMount("), panel.indexOf("onDestroy("));
    expect(mount).not.toMatch(/session\.(signIn|prepareSignIn)\(/);
  });

  it("the webview has no opener capability", () => {
    expect(capabilities).not.toMatch(/"opener:/);
  });
});
