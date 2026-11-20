import type { StandingAction, WorkerFrame } from "../../render-common/workers/worker-unit";
import type { ScriptPresentation } from "../../shared/script-world/actions/script-actions";

/**
 * The map script's presence/movement presentation on the worker frames (TRG5a): fading units get the crowd's
 * existing per-figure `fade` (the same path the storage relocation fade uses on every detail level) and units
 * playing a story clip show it instead of their own action. Islands without a script, or a script with nothing in
 * progress, pass an empty presentation and pay one length check.
 */
export const applyScriptPresentation = (workers: WorkerFrame[], presentation: ScriptPresentation | undefined) => {
  if (!presentation || (!presentation.fades.length && !presentation.clips.length)) return;
  for (const worker of workers) {
    const fade = presentation.fades.find(entry => entry.actor === worker.actorId);
    if (fade) worker.fade = fade.opacity;
    const clip = presentation.clips.find(entry => entry.actor === worker.actorId);
    if (clip && worker.combat?.attackProgress == null) worker.action = clip.clip as StandingAction;
  }
};
