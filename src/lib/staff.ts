// Staff-only tools (role "staff" or "admin" on Skywalker). For a non-staff user these
// return a permission-style error; the UI shows "staff only" rather than a raw failure.
import type { AppError } from "./api";

export const STAFF_TOOLS = new Set([
  "skywalker_fleet",
  "skywalker_spend_all",
  "skywalker_budgets",
  "skywalker_spend_trend",
]);

export function isStaffOnly(tool: string): boolean {
  return STAFF_TOOLS.has(tool);
}

/** Plain text for a staff tool's error. Non-staff users get a clear reason, not a stack trace. */
export function staffNotice(tool: string, e: AppError, isStaff: boolean | null): string | null {
  if (!isStaffOnly(tool)) return null;
  if (isStaff === false) return "Staff only: this view needs Skywalker staff access on your Google account.";
  if (e.kind === "permission" || e.kind === "invalid") {
    return "Staff only: this view needs Skywalker staff access on your Google account.";
  }
  return null;
}
