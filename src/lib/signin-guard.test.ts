import { describe, expect, it } from "vitest";

// Guard for the P0 sign-in bug: no test, and no screenshot path, may reach the real
// sign-in bridge. The only UI reference to sign_in must be the SignIn panel's second
// click (through session.signIn), and nothing may call it on load.
//
// Sources are read with Vite's ?raw imports, so this needs no Node types.
// Keys come back relative to this file (./x.ts, ../components/x.svelte). Normalize to "lib/x.ts" etc.
const RAW = import.meta.glob("../**/*.{ts,svelte}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const SOURCES: Record<string, string> = {};
for (const [k, v] of Object.entries(RAW)) {
  const rel = k.replace(/^(\.\.\/|\.\/)/, "").replace(/^\.\.\//, "");
  SOURCES[rel.startsWith("lib/") || rel.startsWith("components/") || rel.startsWith("pages/") ? rel : `lib/${rel}`] = v;
}

const src = (rel: string): string => {
  const v = SOURCES[rel];
  if (v === undefined) throw new Error(`missing source ${rel}`);
  return v;
};

/** Drop // line comments and /* block comments so prose cannot trip the guard. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
}

describe("sign-in can only start from the Sign in panel", () => {
  it("only SignIn-panel code and the bridge definition reference sign_in", () => {
    const hits = Object.entries(SOURCES)
      .filter(([k]) => !k.endsWith(".test.ts"))
      // Real call sites only: the command name in a string, or a method call. Comments are ignored.
      .filter(([, v]) => /"sign_in"|bridge\.signIn\(|session\.signIn\(|this\.signIn\(/.test(stripComments(v)))
      .map(([k]) => k)
      .sort();
    expect(hits).toEqual(["components/SignIn.svelte", "lib/api.ts", "lib/signin.svelte.ts"]);
  });

  it("the sign-in call site is inside the second-click handler only", () => {
    const panel = src("components/SignIn.svelte");
    const onConfirm = panel.slice(panel.indexOf("function onConfirm"), panel.indexOf("function onCancel"));
    expect(onConfirm).toContain("session.signIn()");
    expect(onConfirm).toContain("gate.confirm(");
    // The first click only prepares a nonce; it never opens the browser.
    const onFirst = panel.slice(panel.indexOf("function onFirst"), panel.indexOf("function onConfirm"));
    expect(onFirst).not.toContain("session.signIn()");
  });

  it("nothing starts sign-in on mount, on load or on a timer", () => {
    for (const f of ["lib/signin.svelte.ts", "components/Shell.svelte", "components/SignIn.svelte"]) {
      expect(src(f)).not.toMatch(/onMount\([^)]*\)\s*=>\s*\{?[^}]*signIn\(/s);
    }
  });

  it("the demo session never reaches the bridge", () => {
    const s = src("lib/signin.svelte.ts");
    const demoBranch = s.slice(s.indexOf("if (__DEMO__)"), s.indexOf("try {", s.indexOf("if (__DEMO__)")));
    expect(demoBranch).toContain("return;");
    expect(demoBranch).not.toContain("bridge.");
  });
});
