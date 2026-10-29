<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { session } from "../lib/signin.svelte";
  import { describeError } from "../lib/api";
  import { IntentGate } from "../lib/signin-gate";

  // Sign-in starts ONLY after two deliberate clicks (see src/lib/signin-gate.ts).
  const gate = new IntentGate(Date.now());
  let step = $state<"idle" | "confirm">("idle");

  const activate = () => {
    gate.noteActivation(Date.now());
    step = gate.step;
  };
  const onVis = () => {
    if (document.visibilityState === "visible") activate();
  };
  onMount(() => {
    window.addEventListener("focus", activate);
    document.addEventListener("visibilitychange", onVis);
  });
  onDestroy(() => {
    window.removeEventListener("focus", activate);
    document.removeEventListener("visibilitychange", onVis);
  });

  function onFirst(e: MouseEvent) {
    e.preventDefault();
    if (gate.first(Date.now(), e.isTrusted, e.detail)) {
      step = gate.step;
      void session.prepareSignIn();
    }
  }
  function onConfirm(e: MouseEvent) {
    e.preventDefault();
    const ok = gate.confirm(Date.now(), e.isTrusted, e.detail);
    step = gate.step;
    if (ok) void session.signIn();
  }
  function onCancel(e: MouseEvent) {
    e.preventDefault();
    gate.cancel();
    step = gate.step;
  }
</script>

<div class="signin">
  <div class="panel card">
    <img src="/app-icon.png" alt="" width="64" height="64" />
    <h1>Telescope</h1>
    <p class="muted">
      A read-only view of a research Google Cloud fleet: spend, budgets, compute, access and exposure.
      It reads through Skywalker as you, so you see only what your own Google account can see.
    </p>
    {#if session.busy}
      <button class="btn primary big" disabled>Waiting for your browser…</button>
    {:else if step === "confirm"}
      <p class="small">Telescope will open your browser to sign in to Skywalker with your Google account.</p>
      <div class="row">
        <button class="btn big" onclick={onCancel}>Cancel</button>
        <button class="btn primary big" onclick={onConfirm} onkeydown={(e) => e.preventDefault()}>Open browser</button>
      </div>
    {:else}
      <button class="btn primary big" onclick={onFirst} onkeydown={(e) => e.preventDefault()}>Sign in with Google</button>
    {/if}
    {#if session.notice}
      <p class="faint small">{session.notice}</p>
    {/if}
    {#if session.error}
      <div class="notice error" role="alert" style="margin-top:14px;text-align:left">{describeError(session.error)}</div>
    {/if}
    <p class="tiny faint">Server: {session.status?.server_url ?? "loading…"}</p>
  </div>
</div>

<style>
  .signin { height: 100%; display: grid; place-items: center; background: var(--bg); background-image: var(--glow); padding-top: 22px; }
  .panel { width: min(460px, 92vw); text-align: center; display: grid; justify-items: center; gap: 12px; padding: 34px 30px; }
  h1 { margin: 6px 0 0; font-size: 26px; letter-spacing: -0.02em; }
  p { margin: 0; max-width: 380px; }
  .big { padding: 10px 18px; font-size: 14px; margin-top: 6px; }
  .row { display: flex; gap: 10px; }
</style>
