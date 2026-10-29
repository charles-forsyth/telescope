// App-wide sign-in state, shared by the shell, the gate and Settings.
import { asAppError, bridge, type AppError, type Settings, type StatusOut } from "./api";

class Session {
  status = $state<StatusOut | null>(null);
  error = $state<AppError | null>(null);
  busy = $state(false);
  notice = $state<string | null>(null);

  async load(): Promise<void> {
    if (__DEMO__) {
      // DEMO builds skip the keychain and show fixture data, labelled DEMO.
      this.status = {
        signed_in: true,
        email: "pi@example.edu (DEMO)",
        scope: "demo",
        expires_at: null,
        server_url: "demo fixtures",
        settings: { server_url: "demo fixtures", theme: "dark", refresh_minutes: 5, client_id: null },
        build: "demo",
      };
      return;
    }
    try {
      this.status = await bridge.status();
      this.error = null;
    } catch (e) {
      this.error = asAppError(e);
    }
  }

  private nonce: string | null = null;

  /** First deliberate click: Rust mints a one-time nonce. Opens nothing. */
  async prepareSignIn(): Promise<void> {
    try {
      this.nonce = await bridge.beginSignIn();
    } catch (e) {
      this.nonce = null;
      this.error = asAppError(e);
    }
  }

  /** Second, separate click: spend the nonce. Rust refuses it if < 300 ms old or the window is unfocused. */
  async signIn(): Promise<void> {
    const nonce = this.nonce;
    this.nonce = null;
    if (!nonce) return;
    this.busy = true;
    this.error = null;
    this.notice = "Finish signing in in your browser. Telescope will pick it up automatically.";
    try {
      this.status = await bridge.signIn(nonce);
      this.notice = null;
    } catch (e) {
      this.error = asAppError(e);
      this.notice = null;
    } finally {
      this.busy = false;
    }
  }

  async signOut(): Promise<void> {
    this.busy = true;
    try {
      const warn = await bridge.signOut();
      await this.load();
      this.notice = warn ? `Signed out here. ${warn}` : "Signed out. Your Google grant is revoked.";
    } catch (e) {
      this.error = asAppError(e);
    } finally {
      this.busy = false;
    }
  }

  async save(s: Settings): Promise<void> {
    try {
      const saved = await bridge.saveSettings(s);
      if (this.status) this.status = { ...this.status, settings: saved, server_url: saved.server_url };
      this.error = null;
    } catch (e) {
      this.error = asAppError(e);
    }
  }
}

export const session = new Session();
