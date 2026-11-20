/**
 * CIN3 step runners per kind (plan section 3.2). Presentation steps run here on the player's clock; world steps
 * (spawn, walk, face) only hand their step to the world port (CIN4 records them as commands); weather, time of
 * day, sound and music go to the effects port hooks (CIN6), except weather and time of day on a world-environment
 * island, which are world steps too (ENV0). `cameraFollow` holds the camera until CIN4 provides
 * actor positions.
 */
import type {
  CinematicStep, CinematicStepKind, CinematicStepOf
} from "../../../../../island-of-settlers-shared/src/campaign/cinematics/types";
import { clamp01 } from "../../../shared/world/noise";
import { LIGHTNING_REPEAT_MS } from "./constants";
import type { CinematicLook, CinematicRunContext, StepRunner, StepRunnerFactory } from "./run-context";
import { createSpeakRunner } from "./speak-runner";

type NumericLook = "fade" | "letterbox";

const progress = (nowMs: number, startMs: number, durationMs: number) =>
  durationMs > 0 ? clamp01((nowMs - startMs) / durationMs) : 1;

/** A step that only lasts its scheduled duration (or is instant). */
const timedRunner = (durationMs: number, onBegin?: (startMs: number) => void, onFinish?: (begun: boolean) => void):
  StepRunner => {
  let startMs = 0;
  return {
    begin: start => {
      startMs = start;
      onBegin?.(start);
    },
    finish: begun => onFinish?.(begun),
    settled: nowMs => nowMs >= startMs + durationMs,
    update: () => undefined
  };
};

/** World steps: sent once at their start; a skipped sequence's world port applies the rest at its end. */
const worldRunner = (durationMs: number): StepRunnerFactory => (step, { ports, sequenceId }) =>
  timedRunner(durationMs, () => ports.world.applyStep(sequenceId, step));

/** Ramps one look value (letterbox, fade) from where it is to `target`; `onDone` runs once at the end. */
const lookRamp = (look: CinematicLook, key: NumericLook, target: number, durationMs: number, onDone?: () => void):
  StepRunner => {
  let from = 0, startMs = 0, done = false;
  const complete = () => {
    look[key] = target;
    if (done) return;
    done = true;
    onDone?.();
  };
  return {
    begin: start => {
      startMs = start;
      from = look[key];
    },
    finish: complete,
    settled: nowMs => nowMs >= startMs + durationMs,
    update: nowMs => {
      const amount = progress(nowMs, startMs, durationMs);
      look[key] = from + (target - from) * amount;
      if (amount >= 1) complete();
    }
  };
};

const cinematicModeRunner: StepRunnerFactory<CinematicStepOf<"cinematicMode">> = (step, context) => {
  const { director, look, mode } = context;
  if (step.on) {
    const ramp = lookRamp(look, "letterbox", step.letterbox ? 1 : 0, step.transitionMs);
    return { ...ramp, begin: start => { mode.enter(); ramp.begin(start); } };
  }
  const ramp = lookRamp(look, "letterbox", 0, step.transitionMs, mode.exit);
  return {
    ...ramp,
    begin: start => {
      director.restoreOver(step.transitionMs, start);
      ramp.begin(start);
    },
    finish: begun => {
      director.reset();
      ramp.finish(begun);
    }
  };
};

const fadeRunner: StepRunnerFactory<CinematicStepOf<"fade">> = (step, context) => {
  const { look } = context;
  const ramp = lookRamp(look, "fade", step.to === "clear" ? 0 : 1, step.durationMs);
  return {
    ...ramp,
    begin: start => {
      if (step.to !== "clear") look.fadeColor = step.to;
      ramp.begin(start);
    }
  };
};

const cameraRunner: StepRunnerFactory<CinematicStepOf<"camera">> = (step, context) => {
  const { director, ports } = context;
  const durationMs = step.transitionMs + (step.drift?.durationMs ?? 0);
  return timedRunner(durationMs, start => {
    const to = context.shotOrbit(step.shotId);
    if (!to) return;
    const { drift } = step;
    const targetTo = drift?.targetToRegionId ? context.regionPoint(drift.targetToRegionId) ?? undefined : undefined;
    director.moveTo({
      drift: drift && { distanceTo: drift.distanceTo, durationMs: drift.durationMs, ease: drift.ease,
        fovTo: drift.fovTo, pitchBy: drift.pitchBy, targetTo, yawBy: drift.yawBy },
      ease: step.ease, to, transitionMs: step.transitionMs
    }, start, ports.view.drawnOrbit);
  });
};

const lightningRunner: StepRunnerFactory<CinematicStepOf<"lightning">> = (step, context) => {
  const count = Math.max(1, step.count);
  let startMs = 0, struck = 0;
  const strikeAt = () => {
    const orbit = context.director.orbitAt(startMs);
    const point = step.regionId ? context.regionPoint(step.regionId) : null;
    const x = point?.x ?? orbit?.targetX ?? context.ports.view.cellsX / 2;
    const z = point?.z ?? orbit?.targetZ ?? context.ports.view.cellsZ / 2;
    context.ports.effects.strikeLightning(x, z);
  };
  return {
    begin: start => { startMs = start; },
    // A skip drops the strikes still to come: a flash is not part of the end state.
    finish: () => { struck = count; },
    settled: () => struck >= count,
    update: nowMs => {
      const due = Math.min(count, Math.floor((nowMs - startMs) / LIGHTNING_REPEAT_MS) + 1);
      for (; struck < due; struck++) strikeAt();
    }
  };
};

const shakeRunner: StepRunnerFactory<CinematicStepOf<"cameraShake">> = (step, { director }) =>
  timedRunner(step.durationMs, start => director.shake(step.strength, step.durationMs, start),
    () => director.stopShake());

const highlightRunner: StepRunnerFactory<CinematicStepOf<"highlight">> = (step, context) =>
  timedRunner(0, () => context.setHighlight(step.regionId, step.on));

/** World weather on a world-environment island (ENV0); the presentation follows its fade. */
const weatherRunner: StepRunnerFactory<CinematicStepOf<"weather">> = (step, context) => {
  const { ports } = context;
  if (ports.world.ownsStep?.(step)) return worldRunner(step.transitionMs)(step, context);
  return timedRunner(step.transitionMs, () => ports.effects.weather?.(step.state, step.transitionMs),
    () => ports.effects.weather?.(step.state, 0));
};

/** On a world-environment island the hour is simulation state (ENV0): the step is a recorded world step. */
const timeOfDayRunner: StepRunnerFactory<CinematicStepOf<"timeOfDay">> = (step, context) => {
  const { ports } = context;
  if (ports.world.ownsStep?.(step)) return worldRunner(0)(step, context);
  return timedRunner(0, () => ports.effects.timeOfDay?.(step.hour, false),
    () => ports.effects.timeOfDay?.(step.hour, true));
};

const musicRunner: StepRunnerFactory<CinematicStepOf<"music">> = (step, { ports }) =>
  timedRunner(0, () => ports.effects.music?.(step.trackId, step.fadeMs), begun => {
    if (!begun) ports.effects.music?.(step.trackId, 0);
  });

const soundRunner: StepRunnerFactory<CinematicStepOf<"sound">> = (step, { ports }) =>
  timedRunner(0, () => ports.effects.sound?.(step.cueId));

/** "Wait until arrived" ends on the actor's arrival event (CIN4 calls the player's `notifyArrived`) or the timeout. */
const walkRunner: StepRunnerFactory<CinematicStepOf<"walk">> = (step, context) => {
  const base = worldRunner(0)(step, context);
  let startMs = 0;
  let arrivedAtMs: number | null = null;
  return {
    ...base,
    arrive: nowMs => {
      if (arrivedAtMs !== null || !step.waitUntilArrived) return;
      arrivedAtMs = nowMs;
      context.reanchor(step.id, nowMs - startMs);
    },
    begin: start => {
      startMs = start;
      base.begin(start);
    },
    settled: nowMs => !step.waitUntilArrived || arrivedAtMs !== null || nowMs >= startMs + step.timeoutMs
  };
};

const RUNNERS: { [K in CinematicStepKind]: StepRunnerFactory<CinematicStepOf<K>> } = {
  camera: cameraRunner,
  cameraFollow: step => timedRunner(step.durationMs),
  cameraShake: shakeRunner,
  cinematicMode: cinematicModeRunner,
  face: worldRunner(0),
  fade: fadeRunner,
  highlight: highlightRunner,
  lightning: lightningRunner,
  music: musicRunner,
  sound: soundRunner,
  spawn: worldRunner(0),
  speak: createSpeakRunner,
  timeOfDay: timeOfDayRunner,
  walk: walkRunner,
  weather: weatherRunner
};

export const createStepRunner = (step: CinematicStep, context: CinematicRunContext): StepRunner =>
  (RUNNERS[step.kind] as StepRunnerFactory)(step, context);

/** The automatic close of a sequence that left cinematic mode on (restore blend + letterbox slide-out). */
export const createAutoCloseRunner = (context: CinematicRunContext, durationMs: number) =>
  cinematicModeRunner({ delayMs: 0, id: "auto-close", kind: "cinematicMode", letterbox: false, on: false,
    start: "afterPrevious", transitionMs: durationMs }, context);
