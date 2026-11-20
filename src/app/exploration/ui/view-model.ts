import type { I18n } from "@lingui/core";

import { actorActionEnabled } from "../../../render-common/workers/actor-action-capabilities";
import { translateMessage } from "../../../shared/i18n/translate";
import { joinClassNames } from "../../components/helpers";
import {
  explorationInputPolicy,
  type ExplorationPhase,
  type ExplorationUiSnapshot
} from "../contracts";
import { EXPLORATION_SPYGLASS_ZOOM_DEFAULT } from "../movement";
import { EXPLORATION_MESSAGES } from "./messages";

export interface ExplorationEntryView {
  ariaLabel: string;
  badge: string;
  className: string;
  disabled: boolean;
  title: string;
}

const ACTIVE_PHASES: ReadonlySet<ExplorationPhase> = new Set([
  "dissipating",
  "entering",
  "possessed",
  "returning"
]);

const activeOrPreparing = (phase: ExplorationPhase) => phase === "preparing" || ACTIVE_PHASES.has(phase);

/** The button is present on the home island and while an exploration session is still settling. */
export const isExplorationEntryVisible = (snapshot: ExplorationUiSnapshot | null) => {
  if (!snapshot || snapshot.phase === "disposed") return false;
  return snapshot.eligibility.eligible || activeOrPreparing(snapshot.phase);
};

const countdownSeconds = (milliseconds: number) => Math.max(1, Math.ceil(milliseconds / 1000));

const entryView = (
  state: "active" | "blocked" | "cooldown" | "idle" | "preparing",
  ariaLabel: string,
  title: string,
  badge = ""
): ExplorationEntryView => ({
  ariaLabel,
  badge,
  className: joinClassNames("player-hud__exploration", `is-${state}`),
  disabled: state !== "idle",
  title
});

/** The entry affordance's translated, disabled/countdown-aware view. */
export const selectExplorationEntryView = (
  snapshot: ExplorationUiSnapshot | null,
  i18n?: I18n
): ExplorationEntryView | null => {
  if (!isExplorationEntryVisible(snapshot) || !snapshot) return null;
  if (snapshot.cooldownInMs > 0 || snapshot.phase === "cooldown") {
    const seconds = countdownSeconds(snapshot.cooldownInMs);
    const label = translateMessage(i18n, EXPLORATION_MESSAGES.entry.cooldownLabel, { seconds });
    return entryView(
      "cooldown",
      label,
      label,
      translateMessage(i18n, EXPLORATION_MESSAGES.entry.cooldownBadge, { seconds })
    );
  }
  if (snapshot.phase === "preparing") {
    return entryView(
      "preparing",
      translateMessage(i18n, EXPLORATION_MESSAGES.entry.preparingLabel),
      translateMessage(i18n, EXPLORATION_MESSAGES.entry.preparingTitle)
    );
  }
  if (ACTIVE_PHASES.has(snapshot.phase)) {
    return entryView(
      "active",
      translateMessage(i18n, EXPLORATION_MESSAGES.entry.activeLabel),
      translateMessage(i18n, EXPLORATION_MESSAGES.entry.activeTitle)
    );
  }
  if (!snapshot.canEnter || !snapshot.eligibility.eligible) {
    return entryView(
      "blocked",
      translateMessage(i18n, EXPLORATION_MESSAGES.entry.blockedLabel),
      translateMessage(i18n, EXPLORATION_MESSAGES.entry.blockedTitle)
    );
  }
  return entryView(
    "idle",
    translateMessage(i18n, EXPLORATION_MESSAGES.entry.label),
    translateMessage(i18n, EXPLORATION_MESSAGES.entry.title)
  );
};

/** A refusal keeps normal play intact; known controller reasons get a specific sentence. */
export const explorationRefusalNotice = (reason: string, i18n?: I18n) => {
  if (reason === "no-safe-spawn") return translateMessage(i18n, EXPLORATION_MESSAGES.refusal.noSafeSpawn);
  return translateMessage(i18n, EXPLORATION_MESSAGES.refusal.generic);
};

export interface ExplorationOverlayView {
  actorType: string;
  showZoomIn: boolean;
  showZoomOut: boolean;
  controlsLabel: string;
  fullscreenLabel: string;
  joystickLabel: string;
  joystickTitle: string;
  leaveDisabled: boolean;
  leaveText: string;
  leaveTitle: string;
  lookJoystickLabel: string;
  lookJoystickTitle: string;
  lookLabel: string;
  lookTitle: string;
  notice?: string;
  phase: ExplorationPhase;
  showJoystick: boolean;
  showLeave: boolean;
  showLook: boolean;
  showSpyglass: boolean;
  spyglassDisabled: boolean;
  spyglassLabel: string;
  spyglassPressed: boolean;
  spyglassTitle: string;
  spyglassZoomInLabel: string;
  spyglassZoomLabel: string;
  spyglassZoomOutLabel: string;
  spyglassZoomText: string;
  statusLabel: string;
  visible: boolean;
}

const spyglassTitle = (snapshot: ExplorationUiSnapshot, enabled: boolean, i18n?: I18n) => {
  if (!enabled) return translateMessage(i18n, EXPLORATION_MESSAGES.overlay.spyglassDisabled);
  return translateMessage(
    i18n,
    snapshot.spyglass ? EXPLORATION_MESSAGES.overlay.spyglassOn : EXPLORATION_MESSAGES.overlay.spyglassOff
  );
};

/** Everything the active overlay renders, including the refusal/status line. */
export const selectExplorationOverlayView = (
  snapshot: ExplorationUiSnapshot | null,
  i18n?: I18n
): ExplorationOverlayView | null => {
  if (!snapshot) return null;
  const resting = snapshot.phase === "idle" || snapshot.phase === "disposed" || snapshot.phase === "cooldown";
  if (resting && !snapshot.notice) return null;
  const policy = explorationInputPolicy(snapshot.phase,snapshot.actorType ?? "Scout");
  const actorType = snapshot.actorType ?? "Scout";
  const spyglassAllowed = actorActionEnabled(actorType,"spyglass");
  const leaveSeconds = Math.ceil(Math.max(0, snapshot.leaveUnlockInMs) / 1000);
  const leaveDisabled = snapshot.leaveUnlockInMs > 0;
  return {
    actorType,
    showZoomIn: actorActionEnabled(actorType,"zoomIn"),
    showZoomOut: actorActionEnabled(actorType,"zoomOut"),
    controlsLabel: translateMessage(i18n, EXPLORATION_MESSAGES.overlay.label),
    fullscreenLabel: translateMessage(i18n, EXPLORATION_MESSAGES.overlay.fullscreen),
    joystickLabel: translateMessage(i18n, EXPLORATION_MESSAGES.overlay.move),
    joystickTitle: translateMessage(i18n, EXPLORATION_MESSAGES.overlay.moveTitle),
    leaveDisabled,
    leaveText: translateMessage(i18n, EXPLORATION_MESSAGES.overlay.leave),
    leaveTitle: leaveDisabled
      ? translateMessage(i18n, EXPLORATION_MESSAGES.overlay.leaveIn, { seconds: leaveSeconds })
      : translateMessage(i18n, EXPLORATION_MESSAGES.overlay.leave),
    lookJoystickLabel: translateMessage(i18n, EXPLORATION_MESSAGES.overlay.lookJoystick),
    lookJoystickTitle: translateMessage(i18n, EXPLORATION_MESSAGES.overlay.lookJoystickTitle),
    lookLabel: translateMessage(i18n, EXPLORATION_MESSAGES.overlay.look),
    lookTitle: translateMessage(i18n, EXPLORATION_MESSAGES.overlay.lookTitle),
    notice: snapshot.notice,
    phase: snapshot.phase,
    showJoystick: policy.move,
    showLeave: policy.leave,
    showLook: policy.look,
    showSpyglass: policy.leave && spyglassAllowed,
    spyglassDisabled: !policy.spyglass || !spyglassAllowed,
    spyglassLabel: translateMessage(i18n, EXPLORATION_MESSAGES.overlay.spyglass),
    spyglassPressed: snapshot.spyglass && spyglassAllowed,
    spyglassTitle: spyglassTitle(snapshot, policy.spyglass && spyglassAllowed, i18n),
    spyglassZoomInLabel: translateMessage(i18n, EXPLORATION_MESSAGES.overlay.spyglassZoomIn),
    spyglassZoomLabel: translateMessage(i18n, EXPLORATION_MESSAGES.overlay.spyglassZoom),
    spyglassZoomOutLabel: translateMessage(i18n, EXPLORATION_MESSAGES.overlay.spyglassZoomOut),
    spyglassZoomText: translateMessage(i18n, EXPLORATION_MESSAGES.overlay.spyglassZoomValue, {
      zoom: (snapshot.spyglassZoom ?? EXPLORATION_SPYGLASS_ZOOM_DEFAULT).toFixed(1)
    }),
    statusLabel: translateMessage(i18n, EXPLORATION_MESSAGES.overlay.status),
    visible: policy.suppressNormal || snapshot.phase === "preparing" || Boolean(snapshot.notice)
  };
};
