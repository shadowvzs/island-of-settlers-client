import type {
  ScriptAudioEffect, ScriptMailEffect, ScriptUiEffect, ScriptUiHighlight
} from "../../../../../island-of-settlers-shared/src/script/engine/ui-effects";
import { DEFERRED_EFFECT_LIMIT_MS } from "./constants";
import type { HighlightStore } from "./highlight-store";
import { uiAnchorChain } from "./ui-anchors";
import { openerOf, type UiTargetOpeners } from "./ui-targets";

type FocusCameraEffect = Extract<ScriptUiEffect, { kind: "focusCamera" }>;

const isAudioEffect = (effect: ScriptUiEffect): effect is ScriptAudioEffect =>
  effect.kind === "playSound" || effect.kind === "playMusic" || effect.kind === "stopMusic";

export interface ScriptPresentationPorts {
  /** The recorded `scriptUiAck` command; false when no run waits on that effect any more. */
  acknowledge: (effectId: string) => boolean;
  deliverMail: (mail: ScriptMailEffect) => void;
  /** Sounds and music (they need no HUD: they play at once, also during a cinematic). */
  playAudio: (effect: ScriptAudioEffect) => void;
  focusCamera: (effect: FocusCameraEffect) => void;
  highlights: HighlightStore;
  /** A cinematic or the possessed/FPS view hides the HUD: UI effects wait (design §6.10, deferral). */
  hudHidden: () => boolean;
  log: (line: string) => void;
  now: () => number;
  openers: UiTargetOpeners;
}

interface QueuedEffect {
  effect: ScriptUiEffect;
  queuedAt: number;
}

/**
 * The app side of the script's presentation port (trigger design §6.10). Effects come from the engine outbox after
 * the simulation ticks; nothing here writes simulation state except the recorded acknowledgement of a clicked
 * waiting highlight. Mails are stored and audio plays at once (neither needs the HUD); every other effect waits
 * while the HUD is hidden and is dropped with a log line after 60 s. Reload drops queued effects (only waiting highlights return).
 */
export const createScriptPresentation = (ports: ScriptPresentationPorts) => {
  const queue: QueuedEffect[] = [];
  const apply = (effect: ScriptUiEffect) => {
    switch (effect.kind) {
      case "openUi":
        if (!openerOf(ports.openers, effect.target).open(effect.target)) ports.log(`openUi ${effect.target.kind} refused`);
        return;
      case "closeUi": return openerOf(ports.openers, effect.target).close(effect.target);
      case "highlightUi": return ports.highlights.add(effect.highlight, ports.now());
      case "clearHighlights": return ports.highlights.clearTransient();
      case "focusCamera": return ports.focusCamera(effect);
      case "sendMail": return ports.deliverMail(effect.mail);
      default: return ports.playAudio(effect);
    }
  };
  const flush = () => {
    while (queue.length) apply(queue.shift()!.effect);
  };
  const dropExpired = (now: number) => {
    while (queue.length && now - queue[0]!.queuedAt > DEFERRED_EFFECT_LIMIT_MS)
      ports.log(`deferred ${queue.shift()!.effect.kind} dropped after 60 s`);
  };
  return {
    /** The player clicked an anchor: highlights on it (or on its fallback) that end on a click go away. */
    click: (anchor: string) => {
      for (const highlight of ports.highlights.list()) {
        if (highlight.until !== "clicked" || !uiAnchorChain(highlight.anchor).includes(anchor)) continue;
        if (highlight.waiting && !ports.acknowledge(highlight.effectId))
          ports.log(`scriptUiAck ${highlight.effectId} refused`);
        ports.highlights.remove(highlight.effectId);
      }
    },
    pending: () => queue.length,
    receive: (effects: readonly ScriptUiEffect[]) => {
      for (const effect of effects) {
        if (effect.kind === "sendMail") ports.deliverMail(effect.mail);
        else if (isAudioEffect(effect)) ports.playAudio(effect);
        else if (queue.length || ports.hudHidden()) queue.push({ effect, queuedAt: ports.now() });
        else apply(effect);
      }
    },
    /** Waiting highlights of the run state (reload, acknowledgement, timeout). */
    syncWaiting: (waiting: readonly ScriptUiHighlight[]) => ports.highlights.syncWaiting(waiting, ports.now()),
    update: () => {
      const now = ports.now();
      ports.highlights.expire(now);
      if (ports.hudHidden()) dropExpired(now);
      else flush();
    }
  };
};

export type ScriptPresentation = ReturnType<typeof createScriptPresentation>;
