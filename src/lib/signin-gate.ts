// Sign-in intent gate (review fix for the P0 "sign-in opened on its own").
//
// Evidence from round 1: every unexplained `sign_in invoked` audit line came 5-11 s
// after a QA launch (`open -n`) brought a new, centred Telescope window to the front
// of the user's desktop. The shipped JS only reaches signIn() from a trusted
// pointer event on the big centred button, so the trigger was a real click that was
// meant for the app underneath (the window popped up where the user was clicking).
// Skywalker then completed OAuth silently from the browser's existing Google session,
// so a token landed with no visible decision.
//
// Defence: (1) ignore any press within FOCUS_GRACE_MS of the window appearing or
// regaining focus, (2) require two deliberate clicks on two different buttons
// (Sign in, then "Open browser" in a confirm panel), the second at least
// CONFIRM_MIN_MS after the first, and (3) only a full click (press + release on the
// same element, event.detail >= 1) counts, never pointerdown or keyboard.
export const FOCUS_GRACE_MS = 1500;
export const CONFIRM_MIN_MS = 400;
export const CONFIRM_TTL_MS = 30_000;

export type Step = "idle" | "confirm";

export class IntentGate {
  private activatedAt: number;
  private confirmShownAt: number | null = null;

  constructor(now: number) {
    this.activatedAt = now;
  }

  /** Call on mount, window focus and visibilitychange-to-visible. */
  noteActivation(now: number): void {
    this.activatedAt = now;
    this.confirmShownAt = null;
  }

  get step(): Step {
    return this.confirmShownAt === null ? "idle" : "confirm";
  }

  /** First click ("Sign in with Google"). Returns true when the confirm panel should show. */
  first(now: number, trusted: boolean, detail: number): boolean {
    if (!trusted || detail < 1) return false;
    if (now - this.activatedAt < FOCUS_GRACE_MS) return false;
    this.confirmShownAt = now;
    return true;
  }

  /** Second click ("Open browser"). Returns true only when sign-in may start. */
  confirm(now: number, trusted: boolean, detail: number): boolean {
    const shown = this.confirmShownAt;
    if (shown === null || !trusted || detail < 1) return false;
    if (now - this.activatedAt < FOCUS_GRACE_MS) return false;
    if (now - shown < CONFIRM_MIN_MS || now - shown > CONFIRM_TTL_MS) {
      this.confirmShownAt = null;
      return false;
    }
    this.confirmShownAt = null;
    return true;
  }

  cancel(): void {
    this.confirmShownAt = null;
  }
}
