// Typed bridge to the Rust side. The UI never talks to Skywalker directly.
import { invoke } from "@tauri-apps/api/core";

export interface AppError {
  kind: string;
  message: string;
  retry_after?: number;
}

export interface Settings {
  server_url: string;
  theme: "dark" | "light" | "system";
  refresh_minutes: number;
  client_id: string | null;
}

export interface StatusOut {
  signed_in: boolean;
  email: string | null;
  scope: string | null;
  expires_at: number | null;
  server_url: string;
  settings: Settings;
  build: "release" | "demo";
}

export interface CallResult<T = unknown> {
  data: T;
  fetched_at_ms: number;
  cached: boolean;
}

export const bridge = {
  status: () => invoke<StatusOut>("app_status"),
  beginSignIn: () => invoke<string>("begin_sign_in"),
  signIn: (nonce: string) => invoke<StatusOut>("sign_in", { nonce }),
  signOut: () => invoke<string | null>("sign_out"),
  saveSettings: (s: Settings) => invoke<Settings>("save_settings", { settings: s }),
  listTools: () => invoke<{ tools?: ToolDef[] }>("list_tools"),
  call: <T = unknown>(name: string, args: Record<string, unknown> = {}, maxAgeSecs?: number) =>
    invoke<CallResult<T>>("call_tool", { name, args, maxAgeSecs }),
  clearCache: () => invoke<void>("clear_cache"),
  appDirs: () => invoke<string>("app_dirs"),
};

export interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string | string[]; description?: string; default?: unknown; enum?: unknown[] }>;
    required?: string[];
  };
  annotations?: Record<string, unknown>;
}

export function asAppError(e: unknown): AppError {
  if (e && typeof e === "object" && "kind" in e && "message" in e) {
    return e as AppError;
  }
  return { kind: "unknown", message: String(e) };
}

/** Plain-language text for an error kind, shown per section. */
export function describeError(e: AppError): string {
  switch (e.kind) {
    case "permission":
      return "Your Google account cannot read this. Ask a project owner for access.";
    case "api_disabled":
      return "This API is off for the project. Nothing to show here.";
    case "not_found":
      return "Not found on Google Cloud.";
    case "quota":
      return "Google quota reached for this read. Try again later.";
    case "rate_limited":
      return e.message;
    case "not_signed_in":
    case "reauth":
      return "Sign in again to load this.";
    case "network":
    case "timeout":
      return e.message;
    case "invalid":
      return e.message;
    default:
      return e.message || "Could not load this section.";
  }
}
