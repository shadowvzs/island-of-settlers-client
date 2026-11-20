import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import {
  explorationInputPolicy,
  type ExplorationUiAdapter,
  type ExplorationUiSnapshot
} from "../contracts";
import {
  createExplorationInput,
  type ExplorationInput,
  type ExplorationInputOptions
} from "../input/controller";
import { createExplorationInputGate, type ExplorationInputGate } from "../input/gate";
import { attachExplorationEntry, updateExplorationEntry } from "./entry-store";
import {
  createDefaultExplorationUiHost,
  type ExplorationUiHost
} from "./host";
import {
  createExplorationHudScope,
  type ExplorationHudScope,
  type ExplorationHudScopeRoot,
  shouldHideNormalHud
} from "./hud-scope";
import { EXPLORATION_MESSAGES } from "./messages";
import { createExplorationUiStore, type ExplorationUiStore } from "./ui-store";
import { explorationRefusalNotice } from "./view-model";

export interface ExplorationEntryResult {
  ok: boolean;
  reason?: string;
}

export interface ExplorationUiActions {
  onEnter: () => ExplorationEntryResult | Promise<ExplorationEntryResult>;
  onEscape?: () => void;
  onLeave: () => void;
  onLook?: (yawPerSecond: number, pitchPerSecond: number) => void;
  onMovement?: (forward: number, right: number) => void;
  onJump?: () => void;
  onSpyglass: () => void;
  onSpyglassZoom?: (direction: 1 | -1) => void;
}

export interface ExplorationUiAdapterOptions {
  actions: ExplorationUiActions;
  gate?: ExplorationInputGate;
  host?: ExplorationUiHost;
  i18n?: I18n;
  input?: boolean;
  inputOptions?: Pick<ExplorationInputOptions, "joystickRadius" | "lookSensitivity">;
  mount?: HTMLElement;
  reducedMotion?: boolean;
  root?: ExplorationHudScopeRoot | null;
}

export interface ExplorationUiAdapterHandle extends ExplorationUiAdapter {
  gate: ExplorationInputGate;
  hudScope: ExplorationHudScope;
  input: ExplorationInput | null;
  store: ExplorationUiStore;
}

const NOTICE_TIMEOUT_MS = 6_000;
const noop = () => undefined;

const defaultScopeRoot = (): ExplorationHudScopeRoot | null =>
  typeof document === "undefined" ? null : document.documentElement;

const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const withNotice = (snapshot: ExplorationUiSnapshot, notice?: string): ExplorationUiSnapshot => {
  if (!notice) return snapshot;
  if (snapshot.notice) return snapshot;
  return { ...snapshot, notice };
};

/**
 * Implements the frozen UI adapter: small immutable snapshots, one entry action and a lazily mounted
 * active overlay. It also owns the HUD scope, entry button binding and (optionally) the desktop/mobile
 * input driver. Disposing it restores the normal HUD and input exactly once; it never closes a window
 * or rewrites a game/store flag.
 */
export const createExplorationUiAdapter = (
  options: ExplorationUiAdapterOptions
): ExplorationUiAdapterHandle => {
  const gate = options.gate ?? createExplorationInputGate();
  const ownsGate = !options.gate;
  const store = createExplorationUiStore();
  const hudScope = createExplorationHudScope(
    options.root === undefined ? defaultScopeRoot() : options.root
  );
  const host = options.host ?? createDefaultExplorationUiHost(options.mount);
  let baseSnapshot = store.getSnapshot();
  let localNotice: string | undefined;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let hostUnmount: (() => void) | undefined;
  let hostMounted = false;

  const clearNoticeTimer = () => {
    if (noticeTimer === undefined) return;
    clearTimeout(noticeTimer);
    noticeTimer = undefined;
  };

  const input = options.input === false ? null : createExplorationInput({
    callbacks: {
      onEscape: options.actions.onEscape ?? noop,
      onLeave: options.actions.onLeave,
      onLook: options.actions.onLook ?? noop,
      onMovement: options.actions.onMovement ?? noop,
      onJump: options.actions.onJump,
      onSpyglass: options.actions.onSpyglass,
      onSpyglassZoom: options.actions.onSpyglassZoom
    },
    ...options.inputOptions
  });

  const render = () => {
    if (disposed) return;
    const snapshot = store.publish(withNotice(baseSnapshot, localNotice));
    hudScope.sync(snapshot.phase);
    gate.setPhase(snapshot.phase);
    updateExplorationEntry(snapshot);
    input?.setPolicy(explorationInputPolicy(snapshot.phase, snapshot.actorType ?? "Scout"));
    if (!hostMounted && (snapshot.phase === "preparing" || shouldHideNormalHud(snapshot.phase) ||
      Boolean(snapshot.notice))) {
      hostMounted = true;
      hostUnmount = host.mount({
        actions: { onLeave: options.actions.onLeave, onSpyglass: options.actions.onSpyglass,
          onSpyglassZoom: options.actions.onSpyglassZoom },
        i18n: options.i18n,
        input,
        reducedMotion: options.reducedMotion ?? prefersReducedMotion(),
        store
      });
    }
  };

  const showNotice = (notice: string) => {
    if (disposed) return;
    localNotice = notice;
    clearNoticeTimer();
    noticeTimer = setTimeout(() => {
      noticeTimer = undefined;
      localNotice = undefined;
      render();
    }, NOTICE_TIMEOUT_MS);
    render();
  };

  const clearNotice = () => {
    localNotice = undefined;
    clearNoticeTimer();
  };

  const enter = async () => {
    if (disposed) return;
    clearNotice();
    let result: ExplorationEntryResult | undefined;
    try {
      result = await options.actions.onEnter();
    } catch {
      showNotice(translateMessage(options.i18n, EXPLORATION_MESSAGES.refusal.generic));
      return;
    }
    if (disposed || !result || result.ok) return;
    showNotice(explorationRefusalNotice(result.reason ?? "", options.i18n));
  };

  const detachEntry = attachExplorationEntry({
    onEnter: () => { void enter(); },
    snapshot: baseSnapshot
  });

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearNoticeTimer();
      detachEntry();
      hostUnmount?.();
      hostUnmount = undefined;
      input?.dispose();
      hudScope.dispose();
      if (ownsGate) gate.dispose();
      else gate.setPhase("disposed");
      store.dispose();
    },
    gate,
    hudScope,
    input,
    publish: (snapshot) => {
      if (disposed) return;
      const active = snapshot.phase !== "idle" && snapshot.phase !== "cooldown" &&
        snapshot.phase !== "disposed";
      if (active) clearNotice();
      baseSnapshot = snapshot;
      render();
    },
    store
  };
};
