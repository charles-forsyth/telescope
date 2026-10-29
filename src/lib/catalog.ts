// The server's tool catalogue, fetched once per session (tools/list via Rust).
// Used to decide whether an optional tool exists before a page depends on it: e.g.
// skywalker_credits (credit types split out) is absent on older Skywalker servers,
// and the UI then shows a "needs a Skywalker update" note instead of guessing.
import { asAppError, bridge, type AppError, type ToolDef } from "./api";

let names: Set<string> | null = null;
let pending: Promise<Set<string>> | null = null;
let lastErr: AppError | null = null;

/** Loads tools/list once. A failure is remembered for this session (never retried in a loop). */
export function loadCatalog(): Promise<Set<string>> {
  if (names) return Promise.resolve(names);
  if (!pending) {
    pending = bridge
      .listTools()
      .then((r) => {
        names = new Set((r.tools ?? []).map((t: ToolDef) => t.name));
        lastErr = null;
        return names;
      })
      .catch((e) => {
        lastErr = asAppError(e);
        names = new Set();
        return names;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

/** True when the tool is in the server's catalogue. False until loaded (callers await loadCatalog first). */
export function hasTool(name: string): boolean {
  return names?.has(name) ?? false;
}

export function catalogError(): AppError | null {
  return lastErr;
}

/** Test seam: replace the loaded catalogue without calling the bridge. */
export function setCatalogForTest(list: string[] | null): void {
  names = list === null ? null : new Set(list);
}
