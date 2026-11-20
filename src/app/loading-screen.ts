import type { WorkerNation } from "../render-common/workers/worker-unit";
import { OFFLINE_SKIP_AFTER_MS } from "../shared/balance/offline";
import { readLoadingNation, setLoadingNation } from "./loading-illustrations";
import { LOADING_MESSAGES } from "./loading-messages";
import { languagePreference } from "./localization/language-store";

/** Keep in sync with the loading screen fade in startup.css. */
const FADE_MS = 450;

/** Lets the browser paint the new message before the next long synchronous step. */
const nextPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/**
 * Full-screen loading screen (title and step message in index.html, the illustration added here
 * for the selected nation) shown while the island is generated and the renderer builds; fades out once
 * the world is ready.
 */
export const createLoadingScreen = () => {
  const root = document.getElementById("loading-screen")!;
  const message = root.querySelector<HTMLElement>(".loading-screen__message")!;
  const bar = root.querySelector<HTMLElement>(".loading-screen__bar");
  const panel = root.querySelector<HTMLElement>(".loading-screen__panel") ?? root;
  let skipTimer: number | undefined;
  let skipButton: HTMLButtonElement | undefined;
  let removeTimer: number | undefined;

  const clearSkip = () => {
    if (skipTimer !== undefined) clearTimeout(skipTimer);
    skipTimer = undefined;
    skipButton?.remove();
    skipButton = undefined;
  };

  const setNation = (nation: WorkerNation) => setLoadingNation(root, nation);
  setNation(readLoadingNation());

  /** Shows the current step and waits for it to be painted. */
  const setStep = async (text: string) => {
    message.textContent = text;
    await nextPaint();
  };

  /** Updates the caption without waiting for a paint (catch-up progress arrives often). */
  const setMessage = (text: string) => { message.textContent = text; };

  /** Determinate progress for the catch-up; null restores the indeterminate sweep. */
  const setProgress = (percent: number | null) => {
    if (!bar) return;
    if (percent === null) {
      bar.classList.remove("is-determinate");
      bar.removeAttribute("aria-valuemax");
      bar.removeAttribute("aria-valuemin");
      bar.removeAttribute("aria-valuenow");
      bar.removeAttribute("role");
      bar.style.removeProperty("--loading-progress");
      return;
    }
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    bar.classList.add("is-determinate");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(value));
    bar.style.setProperty("--loading-progress", `${value}%`);
  };

  /**
   * D15: after `delayMs` of real catch-up, offer the explicit discard. Waiting stays the default;
   * the caller must remove the option when the catch-up finishes. Returns the cleanup function.
   */
  const showSkipOption = (onSkip: () => void, delayMs = OFFLINE_SKIP_AFTER_MS) => {
    clearSkip();
    skipTimer = window.setTimeout(() => {
      skipTimer = undefined;
      if (root.classList.contains("is-done") || skipButton) return;
      const button = document.createElement("button");
      button.className = "loading-screen__skip";
      button.type = "button";
      button.textContent = languagePreference.i18n._(LOADING_MESSAGES.skip.action);
      button.onclick = () => {
        button.disabled = true;
        button.textContent = languagePreference.i18n._(LOADING_MESSAGES.discard);
        onSkip();
      };
      panel.append(button);
      skipButton = button;
      button.focus();
    }, Math.max(0, delayMs));
    return clearSkip;
  };

  /** The registration scroll covers the screen: the step caption waits underneath. */
  const setRegistering = (registering: boolean) =>
    root.classList.toggle("is-registering", registering);

  /** The title page (GS3b) shows over the painted, moving scene: the step caption and bar step aside. */
  const setTitle = (shown: boolean) => root.classList.toggle("is-title", shown);

  const hide = () => {
    clearSkip();
    root.classList.add("is-done");
    if (removeTimer !== undefined) clearTimeout(removeTimer);
    removeTimer = window.setTimeout(() => {
      removeTimer = undefined;
      root.remove();
    }, FADE_MS);
  };

  /**
   * Re-shows the page-level loading screen for an in-page island replacement. The node is retained
   * after the normal fade, so teardown/recreation can reuse it without rebuilding the markup.
   */
  const show = () => {
    if (removeTimer !== undefined) {
      clearTimeout(removeTimer);
      removeTimer = undefined;
    }
    if (!root.isConnected) {
      const viewport = document.getElementById("viewport") ?? document.body;
      viewport.append(root);
    }
    clearSkip();
    root.classList.remove("is-done", "is-failed", "is-registering");
    message.removeAttribute("role");
    root.querySelector(".loading-screen__retry")?.remove();
    setProgress(null);
  };

  return { hide, setMessage, setNation, setProgress, setRegistering, setStep, setTitle, show, showSkipOption };
};

/** A failed boot stays readable and offers one explicit retry, without losing saved progress. */
export const showLoadingFailure = (error: unknown) => {
  console.error("Island startup failed", error);
  const root = document.getElementById("loading-screen");
  if (!root) return;
  root.classList.remove("is-done", "is-registering");
  root.classList.add("is-failed");
  const islandsError = error instanceof Error && error.message.includes("Could not create valid islands")
    ? error.message : null;
  const message = root.querySelector<HTMLElement>(".loading-screen__message");
  if (message) {
    message.setAttribute("role", "alert");
    message.textContent = islandsError ?? languagePreference.i18n._(LOADING_MESSAGES.failure.message);
  }
  if (root.querySelector(".loading-screen__retry")) return;
  const retry = document.createElement("button");
  retry.className = "loading-screen__retry";
  retry.textContent = languagePreference.i18n._(LOADING_MESSAGES.failure.reload);
  retry.onclick = () => location.reload();
  const panel = root.querySelector(".loading-screen__panel") ?? root;
  panel.append(retry);
  retry.focus();
  if (islandsError !== null) {
    const choices = document.createElement("div");
    choices.style.maxHeight = "55vh";
    choices.style.overflowY = "auto";
    panel.append(choices);
    void Promise.all([import("./map-generator/mount"), import("./map-generator/actions")])
      .then(([form, settings]) => form.mountIslandForm(choices,
        { i18n: languagePreference.i18n, initial: settings.getInitialIslandChoice(),
          onRecreate: settings.reloadWithNewIsland }));
  }
};
