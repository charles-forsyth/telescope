// DEMO FIXTURES. Compiled only when TELESCOPE_DEMO=1 (vite define __DEMO__).
// Every value here is INVENTED for screenshot QA. The UI labels all of it DEMO.
// Release builds never include this module.
import type { CallResult } from "./api";

const NOW = () => Date.now();
const iso = (d: Date) => d.toISOString();

const r2 = (n: number) => Math.round(n * 100) / 100;

// DEMO scale (review item 3): the real fleet is about 13x this small table. K multiplies every
// usage and budget figure so October usage is about $150k, the real order of magnitude. Budget
// percentages stay the same because budgets scale with spend. Still invented, still labelled DEMO.
const K = 13.2;
// rateOff: this project's credit offset from the month's rate, so some projects run net-negative
// (credits exceed usage). Real behaviour, not a bug.
const RAW = [
  { id: "demo-lab-aurora", lab: "aurora", gross: 4120.55, budget: 2500, p7: 610, p7prev: 290, owner: "aurora", rateOff: -0.03 },
  { id: "demo-lab-basalt", lab: "basalt", gross: 1830.2, budget: 3000, p7: 220, p7prev: 230, owner: "basalt", rateOff: 0.12 },
  { id: "demo-lab-cirrus", lab: "cirrus", gross: 2940.9, budget: 3000, p7: 310, p7prev: 290, owner: "cirrus", rateOff: 0 },
  { id: "demo-lab-dune", lab: "dune", gross: 760.4, budget: 1500, p7: 70, p7prev: 80, owner: "dune", rateOff: -0.06 },
  { id: "demo-lab-echo", lab: "echo", gross: 398.12, budget: 800, p7: 40, p7prev: 42, owner: "echo", rateOff: -0.02 },
  { id: "demo-lab-frost", lab: "frost", gross: 1205.0, budget: null, p7: 120, p7prev: 60, owner: "frost", rateOff: 0.1 },
  { id: "demo-lab-glacier", lab: "glacier", gross: 88.4, budget: 500, p7: 9, p7prev: 10, owner: "glacier", rateOff: -0.08 },
];
const PROJECTS = RAW.map((p) => ({
  ...p,
  gross: r2(p.gross * K),
  budget: p.budget === null ? null : Math.round(p.budget * K),
  p7: r2(p.p7 * K),
  p7prev: r2(p.p7prev * K),
}));

function budgetRow(p: (typeof PROJECTS)[number]) {
  if (p.budget === null) return null;
  const pct = Math.round((p.gross / p.budget) * 1000) / 10;
  return {
    name: `${p.lab} lab budget`,
    id: `bud-${p.lab}`,
    projects: [p.id],
    amount: p.budget,
    last_period_amount: false,
    period: "MONTH",
    credits: "INCLUDE_ALL_CREDITS",
    services: [],
    thresholds: [0.5, 0.9, 1.0],
    pubsub_topic: "budget-throttle",
    spend_this_month: p.gross,
    spend_basis: "gross",
    per_day_7d: Math.round((p.p7 / 7) * 100) / 100,
    pct,
    period_note: "",
    silenced_cap: false,
  };
}

const budgets = PROJECTS.map(budgetRow).filter((b): b is NonNullable<typeof b> => b !== null);

// Demo account-level charge (the PSSA subscription fee plus support, one row with no project).
// Jul to Sep about $184k, October so far $142k (addendum). Invented for DEMO; Apr to Jun are invented too.
const DEMO_FEE = 142_000;
const FEE: Record<string, number> = { "2026-04": 184_000, "2026-05": 184_000, "2026-06": 184_000, "2026-07": 184_000, "2026-08": 184_000, "2026-09": 184_000 };
const feeOf = (month: string) => FEE[month] ?? DEMO_FEE;
const DEMO_CREDIT_RATE = 0.93; // October: credits (all types) about 93% of usage, so usage net is visible but small
// DEMO-only: usage per past month as a share of October (Jul to Aug about 200k gross, Sep about 180k).
// The day sums still equal the month totals (demo-consistency.test.ts).
const SCALE: Record<string, number> = { "2026-04": 0.85, "2026-05": 0.95, "2026-06": 1.05, "2026-07": 1.35, "2026-08": 1.3, "2026-09": 1.2 };
// DEMO-only credit rate per month, 0.88 to 1.05 of usage gross (invented). Credits about -157k to -206k a month.
const RATE: Record<string, number> = { "2026-04": 0.9, "2026-05": 0.92, "2026-06": 0.95, "2026-07": 1.02, "2026-08": 1.01, "2026-09": 0.88 };
const rateOf = (month: string) => RATE[month] ?? DEMO_CREDIT_RATE;
/** A project's credit rate in a month: the month's rate plus its own offset, kept between 0 and 1.2. */
const projRate = (p: (typeof PROJECTS)[number], month: string) => Math.min(1.2, Math.max(0, rateOf(month) + p.rateOff));

function fleetData() {
  const oct = (p: (typeof PROJECTS)[number]) => projRate(p, "2026-10");
  const items = PROJECTS.map((p) => ({ project: p.id, gross: p.gross, credits: r2(-p.gross * oct(p)), net: r2(p.gross * (1 - oct(p))) }));
  items.push({ project: "(none)", gross: feeOf("2026-10"), credits: 0, net: feeOf("2026-10") });
  const usage = items.filter((i) => i.project !== "(none)");
  const gross = r2(usage.reduce((s, i) => s + i.gross, 0) + feeOf("2026-10"));
  const credits = r2(usage.reduce((s, i) => s + i.credits, 0));
  return {
    scopes: ["folders/DEMO"],
    findings: ["DEMO: fleet numbers are invented for screenshots"],
    spend_by_project: { window: { label: "2026-10 to date" }, total: { gross, credits, net: r2(gross + credits) }, items },
    trend: {
      rising: PROJECTS.map((p) => ({ project_id: p.id, gross_last7: p.p7, gross_prev7: p.p7prev, change: r2(p.p7 - p.p7prev), change_pct: p.p7prev ? Math.round(((p.p7 - p.p7prev) / p.p7prev) * 1000) / 10 : null, per_day_now: r2(p.p7 / 7) })).sort((a, b) => b.change - a.change),
      falling: [],
    },
    budgets: { summary: { budgets: budgets.length, over_100pct: budgets.filter((b) => (b.pct ?? 0) >= 100).length, "75_to_100pct": budgets.filter((b) => (b.pct ?? 0) >= 75 && (b.pct ?? 0) < 100).length, unbudgeted_spenders: 1 }, budgets, unbudgeted: unbudgetedRows() },
    compute: { running_vms: 23, projects_with_running_vms: 6, top: [] },
    public_access: [{ resource: "run.googleapis.com/projects/demo-lab-glacier/services/demo-site", project: "demo-lab-glacier" }],
  };
}

/** Projects with no budget (review item 6): gross this month and per day over 7 days, scaled like the rest. */
function unbudgetedRows() {
  return PROJECTS.filter((p) => p.budget === null).map((p) => ({ project_id: p.id, gross_this_month: p.gross, per_day_7d: r2(p.p7 / 7) }));
}

function budgetsData() {
  const f = fleetData();
  return { month: "2026-10", summary: f.budgets.summary, budgets, unbudgeted: f.budgets.unbudgeted, note: "DEMO: invented figures" };
}

function dailyData(month?: string) {
  // Honour `month` (YYYY-MM): days of that month, not the last 30 days. Figures scale like monthlyAll.
  const days: { day: string; gross: number; credits: number; net: number }[] = [];
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : null;
  const scale = !m || m === "2026-10" ? 1 : (SCALE[m] ?? 0.85);
  const rate = m ? rateOf(m) : DEMO_CREDIT_RATE;
  const dim = m ? new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate() : 30;
  const base = new Date();
  for (let i = 0; i < dim; i++) {
    const d = m ? new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, i + 1)) : new Date(base.getTime() - (29 - i) * 86_400_000);
    const v = (180 + 90 * Math.sin(i / 3.2) + (i % 7 === 0 ? 150 : 0)) * scale * K;
    days.push({ day: iso(d).slice(0, 10), gross: Math.round(v * 100) / 100, credits: r2(-v * rate), net: r2(v * (1 - rate)) });
  }
  if (m) {
    // Month view: the days must add up to the month's usage exactly (project rows of monthlyAll),
    // so the daily sums and the monthly figures agree. The last day absorbs the rounding.
    const mo = monthlyAll(m);
    const usage = mo.items.filter((i) => i.project !== "(none)");
    const targetGross = r2(usage.reduce((s, i) => s + i.gross, 0));
    const targetCredits = r2(usage.reduce((s, i) => s + i.credits, 0));
    const raw = days.reduce((s, x) => s + x.gross, 0);
    let g = 0;
    let c = 0;
    days.forEach((x, idx) => {
      if (idx === days.length - 1) {
        x.gross = r2(targetGross - g);
        x.credits = r2(targetCredits - c);
      } else {
        x.gross = r2((x.gross / raw) * targetGross);
        x.credits = r2(-x.gross * rate);
      }
      x.net = r2(x.gross + x.credits);
      g = r2(g + x.gross);
      c = r2(c + x.credits);
    });
  }
  return { items: days, total: { gross: r2(days.reduce((s, x) => s + x.gross, 0)), net: 0 }, window: { label: m ?? "last 30 days" } };
}

function projectOverview(pid: string) {
  const p = PROJECTS.find((x) => x.id === pid) ?? PROJECTS[0];
  const b = budgetRow(p);
  return {
    project_id: p.id,
    generated_at: iso(new Date()),
    seconds: 0.4,
    findings: [
      { level: "alert", area: "iam", text: "DEMO: allUsers holds roles/run.invoker on the project" },
      { level: "warn", area: "waste", text: "DEMO: 2 unattached disks, 340 GB still billing" },
      { level: "info", area: "compute", text: "DEMO: 3 of 5 VMs running" },
    ],
    project: { name: p.id.replace("demo-lab-", "Demo Lab · "), billing_enabled: true, labels: { lab: p.lab, owner: p.owner } },
    spend: { total: { gross: p.gross, credits: -Math.round(p.gross * 0.12 * 100) / 100, net: Math.round(p.gross * 0.88 * 100) / 100 }, window: { label: "2026-10 to date" } },
    budget: { budgets: b ? [b] : [] },
    compute: { summary: { vms: 5, vms_running: 3, vms_with_gpu: 1, gpus_running: ["1x nvidia-tesla-a100"], unattached_disks: 2, unattached_disk_gb: 340, unused_external_ips: 0, static_ips: 1, snapshots: 4, snapshot_stored_gb: 210, custom_images: 1 } },
    exposure: { risks: ["public access (roles/run.invoker) on Cloud Run service demo-site"] },
    recommendations: { total_monthly_saving: 186.5 },
  };
}

function vmList() {
  return [
    { name: "gpu-train-01", zone: "us-west1-b", status: "RUNNING", machine_type: "a2-highgpu-1g", gpus: ["1x nvidia-tesla-a100"], spot: false, external_ips: ["34.1.1.4"], service_accounts: [], labels: {} },
    { name: "notebook-basalt", zone: "us-west1-b", status: "RUNNING", machine_type: "n2-standard-8", gpus: [], spot: false, external_ips: [], service_accounts: [], labels: {} },
    { name: "old-etl", zone: "us-west1-a", status: "TERMINATED", machine_type: "n2-highmem-16", gpus: [], spot: false, external_ips: [], stopped_days: 41, service_accounts: [], labels: {} },
  ];
}

/** One billing month, shaped like billing.spend(group_by="project"). DEMO numbers, invented. */
function monthlyAll(month: string) {
  const m = month === "" ? "2026-10" : month;
  const scale = m === "2026-10" ? 1 : (SCALE[m] ?? 0.85);
  const items = PROJECTS.map((p) => {
    const g = r2(p.gross * scale);
    const rate = projRate(p, m);
    return { project: p.id, gross: g, credits: r2(-g * rate), net: r2(g * (1 - rate)) };
  });
  // The account-level charge (fee plus support) is fixed per month, so it does not scale with usage.
  const fee = feeOf(m);
  items.push({ project: "(none)", gross: fee, credits: 0, net: fee });
  const gross = r2(items.reduce((s, i) => s + i.gross, 0));
  const credits = r2(items.reduce((s, i) => s + i.credits, 0));
  return { window: { label: month || "2026-10" }, total: { gross, credits, net: r2(gross + credits) }, items, truncated: false, currency: "USD", group_by: "project", note: "DEMO: invented monthly figures" };
}

function table(tool: string, args: Record<string, unknown>): unknown {
  const pid = String(args.project_id ?? PROJECTS[0].id);
  switch (tool) {
    case "skywalker_fleet": return fleetData();
    case "skywalker_budgets": return budgetsData();
    case "skywalker_spend_all": return args.group_by === "project" ? monthlyAll(String(args.month ?? "")) : dailyData(String(args.month ?? ""));
    case "skywalker_overview": return projectOverview(pid);
    case "skywalker_spend": {
      if (args.group_by === "day") return dailyData();
      // One DEMO project: services and SKUs add up to the same totals (checked in demo-consistency.test.ts).
      // Scaled to the chosen project's gross from the overview, so one project page shows one total.
      const f = (PROJECTS.find((x) => x.id === pid)?.gross ?? 3760.55) / 3760.55;
      const sc = (n: number) => r2(n * f);
      const total = { gross: sc(3760.55), credits: sc(-451.2), net: sc(3309.27) };
      const svc = [
        { service: "Compute Engine", gross: sc(2600.1), net: sc(2288.1), credits: sc(-312) },
        { service: "Vertex AI", gross: sc(900.25), net: sc(792.2), credits: sc(-108) },
        { service: "Cloud Storage", gross: sc(260.2), net: sc(228.97), credits: sc(-31.2) },
      ];
      const sku = [
        { sku: "Compute Engine / N2 Instance Core running", gross: sc(1480.4), net: sc(1302.8), credits: sc(-177.6) },
        { sku: "Compute Engine / Nvidia A100 80GB GPU running", gross: sc(812.9), net: sc(715.2), credits: sc(-97.7) },
        { sku: "Vertex AI / Training, n1-standard", gross: sc(900.25), net: sc(792.2), credits: sc(-108) },
        { sku: "Compute Engine / Persistent Disk SSD", gross: sc(306.8), net: sc(270.1), credits: sc(-36.7) },
        { sku: "Cloud Storage / Standard Storage US", gross: sc(260.2), net: sc(228.97), credits: sc(-31.2) },
      ];
      if (args.group_by === "sku") return { project_id: pid, window: { label: "2026-10 to date" }, total, items: sku, group_by: "sku" };
      return { project_id: pid, window: { label: "2026-10 to date" }, total, items: svc, group_by: "service" };
    }
    case "skywalker_compute": return { project_id: pid, summary: projectOverview(pid).compute.summary, instances: vmList(), disks: [{ name: "scratch-old", location: "us-west1-a", size_gb: 200, type: "pd-ssd", attached_to: [], status: "READY" }, { name: "gpu-train-01-boot", location: "us-west1-b", size_gb: 100, type: "pd-balanced", attached_to: ["gpu-train-01"], status: "READY" }], addresses: [], snapshots: [], images: [] };
    case "skywalker_services": return { project_id: pid, enabled: 24, costly_or_notable: ["compute.googleapis.com", "aiplatform.googleapis.com"], services: ["aiplatform.googleapis.com", "compute.googleapis.com", "storage.googleapis.com", "iam.googleapis.com"] };
    case "skywalker_inventory": return { project_id: pid, resources: 212, notable: { vm: 5, disk: 6, bucket: 9, bq_dataset: 3 }, by_type: { "compute.googleapis.com/Disk": 6, "storage.googleapis.com/Bucket": 9 } };
    case "skywalker_access": return { project_id: pid, members: 9, owners: ["user:pi@example.edu"], flagged: [{ member: "allUsers", type: "allUsers", roles: ["roles/run.invoker"], flags: ["public"] }, { member: "user:guest@example.org", type: "user", roles: ["roles/viewer"], flags: ["outside_domain"] }], by_role: {}, all: [], truncated: false };
    case "skywalker_service_accounts": return { project_id: pid, service_accounts: 3, old_keys: 1, keys_older_than_days: 90, accounts: [{ email: "sa-pipeline@" + pid + ".iam.gserviceaccount.com", user_managed_keys: [{ age_days: 212 }], old_keys: 1, last_authenticated: "2026-10-20T11:00:00Z" }] , never_or_long_unused: [] };
    case "skywalker_api_keys": return { project_id: pid, keys: 2, unrestricted: 1, unused_in_window: [], window_days: 30, items: [{ name: "lab-website", age_days: 300, api_targets: [], requests_30d: 12, flags: ["no_api_restriction"] }, { name: "ingest", age_days: 40, api_targets: ["aiplatform.googleapis.com"], requests_30d: 9120, flags: [] }] };
    case "skywalker_api_traffic": return { project_id: pid, window_days: 7, by: "service", total_requests: 14210, items: [{ name: "aiplatform.googleapis.com", requests: 9600, errors: 42 }, { name: "compute.googleapis.com", requests: 4000, errors: 3 }, { name: "storage.googleapis.com", requests: 610, errors: 0 }] };
    // DEMO fixture: shaped like security.py (open_firewalls, public_bindings, external_vms, scc_findings). Labelled DEMO on screen.
    case "skywalker_exposure": return { project_id: pid, risks: ["public access (roles/run.invoker) on Cloud Run service demo-site"], public_iam: [{ resource: "run.googleapis.com/projects/" + pid + "/locations/us-west1/services/demo-site", type: "run.googleapis.com/Service", public_roles: ["roles/run.invoker"] }], open_firewall_rules: [{ rule: "allow-jupyter", network: "default", exposes: ["jupyter:8888"], target_tags: ["jupyter"], priority: 1000 }, { rule: "allow-ssh-lab", network: "default", exposes: ["ssh:22"], target_tags: [], priority: 65534 }], vms_with_external_ip: [{ vm: "gpu-train-01", zone: "us-west1-b", state: "RUNNING", external_ips: ["34.1.1.4"] }], security_command_center: { active: 3, by_severity: { HIGH: 1, MEDIUM: 2 }, top: [{ category: "OPEN_JUPYTER_PORT", severity: "HIGH", class: "VULNERABILITY", resource: "gpu-train-01", since: "2026-10-18T08:12:00Z" }, { category: "PUBLIC_BUCKET_ACL", severity: "MEDIUM", class: "MISCONFIGURATION", resource: "lab-data", since: "2026-10-02T17:40:00Z" }, { category: "OPEN_SSH_PORT", severity: "MEDIUM", class: "VULNERABILITY", resource: "allow-ssh-lab", since: "2026-09-29T11:05:00Z" }] } };
    case "skywalker_quotas": return { project_id: pid, service: "compute.googleapis.com", in_use: [{ region: "us-west1", metric: "NVIDIA_A100_GPUS", usage: 1, limit: 2, pct: 50 }, { region: "us-west1", metric: "CPUS", usage: 46, limit: 48, pct: 95.8 }], near_limit: [], gpu_quotas: [{ quota: "NVIDIA A100 GPUs", max_limit: 2, regions: 2 }] };
    case "skywalker_recommendations": return { project_id: pid, total_monthly_saving: 186.5, by_kind: {}, items: [{ kind: "idle_disk", location: "us-west1-a", description: "Delete unattached disk scratch-old", resource: "scratch-old", monthly_saving: 34.2, priority: "P3", category: "COST" }, { kind: "rightsize_vm", location: "us-west1-b", description: "Resize notebook-chen to n2-standard-4", resource: "notebook-basalt", monthly_saving: 152.3, priority: "P2", category: "COST" }], asked: { calls: 12, zones: [], regions: [] } };
    case "skywalker_activity": return { project_id: pid, window_days: 7, entries: 3, more: false, by_principal: { "pi@example.edu": 2, "ci@example.edu": 1 }, items: [{ time: "2026-10-24T15:10:00Z", who: "pi@example.edu", method: "v1.compute.instances.insert", resource: "gpu-train-01", service: "compute.googleapis.com", error: null }, { time: "2026-10-24T09:02:00Z", who: "ci@example.edu", method: "storage.buckets.update", resource: "lab-data", service: "storage.googleapis.com", error: null }, { time: "2026-10-23T18:40:00Z", who: "pi@example.edu", method: "SetIamPolicy", resource: "demo-lab-aurora", service: "cloudresourcemanager.googleapis.com", error: "Permission denied" }] };
    case "skywalker_budget": return { project_id: pid, budgets: b(pid) };
    case "skywalker_projects": return { total: PROJECTS.length, by_parent: {}, projects: PROJECTS.map((p) => ({ project_id: p.id, name: p.id, parent: "folders/DEMO", labels: { lab: p.lab } })), truncated: false };
    case "skywalker_whoami": return { email: "pi@example.edu", role: "staff", google_token_ok: true, note: "DEMO" };
    case "skywalker_focus": return { focus: null, default: PROJECTS[0].id, your_projects: [] };
    case "skywalker_spend_trend": return { window: "DEMO: last 7 days vs previous 7", rising: PROJECTS.map((p) => ({ project_id: p.id, gross_last7: p.p7, gross_prev7: p.p7prev, change: p.p7 - p.p7prev, change_pct: p.p7prev ? Math.round(((p.p7 - p.p7prev) / p.p7prev) * 1000) / 10 : null, per_day_now: Math.round((p.p7 / 7) * 100) / 100 })), falling: [], projects: PROJECTS.length, account_level: { gross_last7: 2350, gross_prev7: 2310, note: "DEMO: charges with no project" } };
    default: return { note: "DEMO: no fixture for this tool" };
  }
}

function b(pid: string) {
  const p = PROJECTS.find((x) => x.id === pid);
  return p ? [budgetRow(p)] : [];
}

export async function demoCall(name: string, args: Record<string, unknown>): Promise<CallResult<unknown>> {
  await new Promise((r) => setTimeout(r, 120));
  return { data: table(name, args), fetched_at_ms: NOW(), cached: false };
}

// Review item 10: the first sentence of each tool's docstring, copied from Skywalker's server.py
// (mcp_server/server.py). Text only, used for the DEMO catalogue so cards read like the real server.
export const DEMO_TOOL_DESC: Record<string, string> = {
  "skywalker_whoami": "Who you are signed in as: email, role, client, and whether Skywalker holds a working Google token for you (it reads Google Cloud as you).",
  "skywalker_projects": "Google Cloud projects you can see.",
  "skywalker_focus": "Show or set your focus: the project every tool uses when you don't name one.",
  "skywalker_overview": "What is happening in one project right now, in one call: findings first (alerts, warnings, notes), then spend this month and the 7-day trend, budget status, running VMs and GPUs, idle disks and IPs, enabled APIs and their traffic, who has access (risky grants flagged), public exposure and open firewall ports, Security Command Center findings, API keys, and the last 7 days of admin changes.",
  "skywalker_spend": "Spend for one project from the Cloud Billing export: gross, credits and net.",
  "skywalker_budget": "The project's budget(s): amount, period, thresholds, throttle topic, this month's spend against it and the 7-day daily rate.",
  "skywalker_inventory": "Everything in a project from Cloud Asset Inventory, every region: counts by type and location.",
  "skywalker_compute": "VMs (status, machine type, GPUs, spot, external IPs, how long stopped), disks (unattached first), static IPs, snapshots and custom images, every zone.",
  "skywalker_recommendations": "Google's Recommender findings with monthly savings: idle VMs, disks, IPs and images, VM and Cloud SQL rightsizing, commitments, unattended project, and unused IAM roles.",
  "skywalker_access": "Who can do what on the project (IAM policy), with risky grants flagged: public members, accounts outside the domain, deleted principals, owner/editor and other admin roles, the default compute service account as editor/owner.",
  "skywalker_service_accounts": "Service accounts, their user-managed keys (age, last used) and when each account last authenticated (Policy Analyzer).",
  "skywalker_api_keys": "API keys: restrictions (which APIs, which apps), bound service account, age, and requests per key and API over the last `days` (1-42).",
  "skywalker_exposure": "Public exposure: resources granted to allUsers/allAuthenticatedUsers, firewall rules opening SSH/RDP/databases/Jupyter to the internet, VMs with external IPs, and active Security Command Center findings by severity.",
  "skywalker_activity": "Admin Activity audit log: who created, deleted, started, stopped or changed what, newest first, with counts by person and method.",
  "skywalker_services": "Enabled APIs on the project, with the ones that usually cost money or deserve a look (Vertex AI, Gemini API, Compute, GKE, Filestore, ...) listed first.",
  "skywalker_api_traffic": "Requests per API over the last `days` (Cloud Monitoring), with error counts.",
  "skywalker_quotas": "Quota usage vs limit by region (near-limit flagged) and GPU quota limits for a service (default Compute Engine).",
  "skywalker_fleet": "[staff] Every project at once: month-to-date spend by project, who is speeding up (7 days vs the 7 before), budgets over 100% and spenders with no budget, running VMs (and GPU machine types) by project, and resources granted public access.",
  "skywalker_spend_all": "[staff] Spend across the whole billing account.",
  "skywalker_budgets": "[staff] Every budget on the billing account with this month's spend and %: status='over' (>=100%), 'warn' (75-99%), 'unbudgeted' (spenders with no budget), or empty for all.",
  "skywalker_spend_trend": "[staff] Which projects are speeding up or slowing down: gross spend in the last 7 days vs the 7 before, per project, plus account-level charges.",
};

export const DEMO_TOOLS = [
  "skywalker_whoami", "skywalker_projects", "skywalker_overview", "skywalker_focus", "skywalker_fleet", "skywalker_inventory",
  "skywalker_compute", "skywalker_services", "skywalker_spend", "skywalker_spend_all", "skywalker_spend_trend", "skywalker_budget",
  "skywalker_budgets", "skywalker_quotas", "skywalker_access", "skywalker_service_accounts", "skywalker_api_keys",
  "skywalker_api_traffic", "skywalker_exposure", "skywalker_recommendations", "skywalker_activity",
];
