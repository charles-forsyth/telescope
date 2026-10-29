// Query store. Every page reads Skywalker through `query()`, which:
//  - serves a fresh cached answer when one exists (Rust holds the cache too),
//  - exposes loading, error and "updated N min ago" state to the UI,
//  - refreshes the open page on a timer (never more often than every 5 minutes),
//  - in DEMO builds only, answers from fixtures and marks every result as demo.
import { asAppError, bridge, type AppError, type CallResult } from "./api";
import { ago } from "./format";
import { now } from "./clock.svelte";

export interface Query<T> {
  readonly data: T | null;
  readonly error: AppError | null;
  readonly loading: boolean;
  readonly fetchedAt: number | null;
  readonly demo: boolean;
  readonly ago: string;
  refresh(force?: boolean): Promise<void>;
  stop(): void;
}

const inflight = new Map<string, Promise<CallResult<unknown>>>();
const MIN_PAGE_REFRESH_MS = 5 * 60_000;

async function fetchTool(name: string, args: Record<string, unknown>, maxAgeSecs: number): Promise<CallResult<unknown>> {
  if (__DEMO__) {
    const { demoCall } = await import("./demo");
    return demoCall(name, args);
  }
  return bridge.call(name, args, maxAgeSecs);
}

/** Call one tool, de-duplicating identical calls that are already in flight. */
export function callOnce<T = unknown>(name: string, args: Record<string, unknown> = {}, maxAgeSecs = 0): Promise<CallResult<T>> {
  const key = `${name}|${JSON.stringify(args)}|${maxAgeSecs}`;
  let p = inflight.get(key);
  if (!p) {
    p = fetchTool(name, args, maxAgeSecs).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p as Promise<CallResult<T>>;
}

export function isDemo(): boolean {
  return __DEMO__;
}

/**
 * A reactive query. `refreshEveryMs` sets an automatic refresh for an open page
 * (clamped to >= 5 minutes). `maxAgeSecs` is how old a cached answer may be on
 * first load (0 = always ask the server).
 */
export function query<T>(
  name: string,
  args: () => Record<string, unknown>,
  opts: { refreshEveryMs?: number; maxAgeSecs?: number; enabled?: () => boolean } = {},
): Query<T> {
  let data = $state<T | null>(null);
  let error = $state<AppError | null>(null);
  let loading = $state(false);
  let fetchedAt = $state<number | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;
  let seq = 0;

  async function refresh(force = false): Promise<void> {
    if (opts.enabled && !opts.enabled()) return;
    const mine = ++seq;
    loading = true;
    try {
      const r = await callOnce<T>(name, args(), force ? 0 : (opts.maxAgeSecs ?? 0));
      if (mine !== seq) return;
      data = r.data;
      fetchedAt = r.fetched_at_ms;
      error = null;
    } catch (e) {
      if (mine !== seq) return;
      error = asAppError(e);
      // A 429 is not an error the user caused; keep the last good data on screen.
    } finally {
      if (mine === seq) loading = false;
    }
  }

  const every = Math.max(MIN_PAGE_REFRESH_MS, opts.refreshEveryMs ?? 0);
  // Gentleness: no polling while the window is hidden. On return, refresh only if the
  // data is older than the page interval. A refresh never sends fresh:true; only the
  // explicit Refresh button (refresh(true)) asks the server to bypass its cache.
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    if (fetchedAt === null || Date.now() - fetchedAt >= every) void refresh(false);
  };
  if (every > 0) {
    timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh(false);
    }, every);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
  }

  return {
    get data() {
      return data;
    },
    get error() {
      return error;
    },
    get loading() {
      return loading;
    },
    get fetchedAt() {
      return fetchedAt;
    },
    get demo() {
      return __DEMO__;
    },
    get ago() {
      return ago(fetchedAt, now.value);
    },
    refresh,
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    },
  };
}
