// The Skywalker tool catalogue: the 21 tools, grouped for the UI. The Explorer
// reads tools/list at runtime; this list only decides where each tool is shown.
export interface ToolGroup {
  id: string;
  label: string;
  tools: string[];
  staff?: boolean;
}

export const TOOL_GROUPS: ToolGroup[] = [
  { id: "orientation", label: "Orientation", tools: ["skywalker_whoami", "skywalker_projects", "skywalker_focus"] },
  { id: "briefing", label: "Briefing", tools: ["skywalker_overview"] },
  { id: "money", label: "Money", tools: ["skywalker_spend", "skywalker_budget", "skywalker_budgets", "skywalker_spend_all", "skywalker_spend_trend"] },
  { id: "resources", label: "Resources", tools: ["skywalker_compute", "skywalker_inventory", "skywalker_services", "skywalker_quotas", "skywalker_recommendations"] },
  { id: "security", label: "Security", tools: ["skywalker_access", "skywalker_service_accounts", "skywalker_api_keys", "skywalker_exposure", "skywalker_activity"] },
  { id: "traffic", label: "Traffic", tools: ["skywalker_api_traffic"] },
  { id: "fleet", label: "Fleet", tools: ["skywalker_fleet"], staff: true },
];

export const ALL_TOOLS = TOOL_GROUPS.flatMap((g) => g.tools);

export const TOOL_LABEL: Record<string, string> = {
  skywalker_whoami: "Who am I",
  skywalker_projects: "Projects",
  skywalker_focus: "Focus",
  skywalker_overview: "Project briefing",
  skywalker_spend: "Spend",
  skywalker_budget: "Project budget",
  skywalker_budgets: "All budgets",
  skywalker_spend_all: "Spend, all projects",
  skywalker_spend_trend: "Spend trend",
  skywalker_compute: "Compute",
  skywalker_inventory: "Inventory",
  skywalker_services: "Enabled services",
  skywalker_quotas: "Quotas",
  skywalker_recommendations: "Recommendations",
  skywalker_access: "Access",
  skywalker_service_accounts: "Service accounts",
  skywalker_api_keys: "API keys",
  skywalker_exposure: "Exposure",
  skywalker_activity: "Activity",
  skywalker_api_traffic: "API traffic",
  skywalker_fleet: "Fleet",
};

export function groupOf(name: string): ToolGroup | undefined {
  return TOOL_GROUPS.find((g) => g.tools.includes(name));
}
