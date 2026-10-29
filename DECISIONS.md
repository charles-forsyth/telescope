# Decisions

- Stack: Tauri 2 + Svelte 5 + Vite + TypeScript + Apache ECharts. Rust does all network I/O;
  the web UI only calls Tauri commands and never sees tokens.
- Auth: OAuth 2.1 + PKCE S256 with the Skywalker server (discovery, /register, loopback
  127.0.0.1:<random port>/callback, /token, refresh, /revoke). Tokens live only in the OS
  keychain (keyring: apple-native, windows-native). Settings (URL, theme, interval, client id)
  live in the app config dir as plain JSON. No secret is compiled in.
- Dynamic client registration happens once; the public client_id is kept in settings.json.
- Read-only: the only Skywalker calls are initialize, notifications/initialized, tools/list and
  tools/call. Sign-out revokes the refresh token at /revoke, then deletes local copies.
- Gentleness: in-memory cache with timestamps; at most 3 in-flight calls (semaphore); 429 honours
  Retry-After, else exponential backoff from 30 s to 300 s; a 401 forces one refresh; refresh is
  serialized so a rotated refresh token is never raced.
- Money: every figure comes from a Skywalker answer. Missing values render as "--". Burn-rate and
  exhaustion projections are computed in src/lib/insights.ts and are labelled as projections.
- Demo fixtures: exist only behind the cargo feature `demo` (and the vite define __DEMO__). Release
  builds are compiled without them, and the UI labels any demo data "DEMO".
- Bundle: macOS app+dmg, ad-hoc signed ("-" identity), not notarized. Windows nsis+msi with the
  WebView2 bootstrapper embedded (silent). Icon: icons-src/telescope-icon.svg -> tauri icon.
- Scope on the server: the server itself enforces who may see what. Telescope does not try to
  widen anything; it shows what the signed-in person's Skywalker answer contains.

## UI Design

- Account-level row: named "account-level charges (subscription fee + support), gross" everywhere. Skywalker does
  not split it, so Telescope never subtracts or estimates the support part.
- Negative net: a month or project where credits exceed usage is drawn as one gross bar with an over marker, never
  below zero. The signed net stays in tooltips and the cents arithmetic line.
- Unbudgeted projects get their own filter on the Budgets page, with "--" for every budget-only column.
- DEMO fixtures scale to a representative order of magnitude. Invented and labelled DEMO.
- Sign-in: source guards added in signin-p0.test.ts; sign-in starts only from a deliberate user action.
