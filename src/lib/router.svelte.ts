// Hash router: #/fleet, #/project/<id>/<tab>, #/budgets, #/billing, #/tools, #/tools/<name>, #/settings.
export type Route =
  | { name: "fleet" }
  | { name: "project"; id: string; tab: string }
  | { name: "budgets" }
  | { name: "billing" }
  | { name: "tools"; tool: string | null }
  | { name: "settings" };

export const PROJECT_TABS = [
  "spend", "compute", "services", "inventory", "access", "accounts", "keys",
  "traffic", "exposure", "quotas", "recommendations", "activity",
] as const;

export function parse(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  const [head, ...rest] = h.split("/");
  switch (head) {
    case "budgets":
      return { name: "budgets" };
    case "billing":
      return { name: "billing" };
    case "tools":
      return { name: "tools", tool: rest[0] ? decodeURIComponent(rest[0]) : null };
    case "settings":
      return { name: "settings" };
    case "project": {
      const id = rest[0] ? decodeURIComponent(rest[0]) : "";
      const tab = PROJECT_TABS.includes(rest[1] as (typeof PROJECT_TABS)[number]) ? rest[1] : "spend";
      return { name: "project", id, tab };
    }
    default:
      return { name: "fleet" };
  }
}

class Router {
  current = $state<Route>(parse(typeof location !== "undefined" ? location.hash : ""));
  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("hashchange", () => {
        this.current = parse(location.hash);
      });
    }
  }
  go(path: string): void {
    location.hash = path;
  }
}

export const router = new Router();

export function projectPath(id: string, tab = "spend"): string {
  return `#/project/${encodeURIComponent(id)}/${tab}`;
}
