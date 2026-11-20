/**
 * One playing sequence (plan section 3.2): the step runners on the real-time presentation clock, re-anchored on real
 * step ends, cinematic mode, the two-press skip and skip-to-end. The queue around it is `sequence-player.ts`.
 */
import { rasterizeRegion } from "../../../../../island-of-settlers-shared/src/campaign/campaign-regions";
import {
  type CinematicStepTiming, scheduleSequence
} from "../../../../../island-of-settlers-shared/src/campaign/cinematics/schedule";
import type { CinematicSequence } from "../../../../../island-of-settlers-shared/src/campaign/cinematics/types";
import type { CinematicFrame, CinematicGlint } from "../../../render-common/cinematic/cinematic-frame";
import type { CameraDirector } from "./camera-director";
import { AUTO_CLOSE_MS, SKIP_CONFIRM_MS } from "./constants";
import { regionCenter, shotToOrbit } from "./helpers";
import type { CinematicPlayerPorts, CinematicSequenceContext } from "./ports";
import type { CinematicPresentation, CinematicSpeakLine } from "./presentation";
import type { CinematicLook, CinematicRunContext, StepRunner } from "./run-context";
import { createAutoCloseRunner, createStepRunner } from "./step-runners";

export interface SequenceRunOptions {
  context: CinematicSequenceContext;
  director: CameraDirector;
  ports: CinematicPlayerPorts;
  presentation: CinematicPresentation;
  sequence: CinematicSequence;
}

interface RunState {
  actual: Map<string, number>;
  closing: StepRunner | null;
  done: boolean;
  glints: CinematicGlint[];
  highlights: Map<string, Int32Array>;
  look: CinematicLook;
  modeOn: boolean;
  nextIndex: number;
  nowMs: number;
  runners: StepRunner[];
  settled: boolean[];
  skipArmedUntilMs: number;
  timings: CinematicStepTiming[];
}

const speakLines = (sequence: CinematicSequence) =>
  sequence.steps.filter((step): step is CinematicSpeakLine => step.kind === "speak");

/** The cinematic mode switches of a run: the ports' snapshot/restore runs once per switch. */
const createModeSwitch = (state: RunState, ports: CinematicPlayerPorts, presentation: CinematicPresentation) => ({
  enter: () => {
    if (state.modeOn) return;
    state.modeOn = true;
    ports.mode.enter();
    presentation.setUi({ active: true });
  },
  exit: () => {
    if (!state.modeOn) return;
    state.modeOn = false;
    ports.mode.exit();
    presentation.setUi({ active: false, skipPrompt: false });
  }
});

const createRunContext = (state: RunState, options: SequenceRunOptions): CinematicRunContext => {
  const { context, director, ports, presentation, sequence } = options;
  const { groundHeight } = ports.view;
  const language = ports.language();
  const msPerChar = ports.msPerChar();
  const lines = speakLines(sequence);
  const region = (regionId: string) => context.regions.find(candidate => candidate.id === regionId) ?? null;
  const cells = new Map<string, Int32Array>();
  const regionCells = (regionId: string) => {
    const found = region(regionId);
    if (!found) return null;
    let cached = cells.get(regionId);
    if (!cached) cells.set(regionId, cached = Int32Array.from(rasterizeRegion(found, ports.view.cellsX,
      ports.view.cellsZ)));
    return cached;
  };
  return {
    director, language, look: state.look, mode: createModeSwitch(state, ports, presentation), msPerChar, ports,
    presentation, regionCells, sequenceId: sequence.id,
    lineIndexOf: stepId => lines.findIndex(line => line.id === stepId),
    reanchor: (stepId, durationMs) => {
      state.actual.set(stepId, durationMs);
      state.timings = scheduleSequence(sequence.steps, { actualDurationsMs: state.actual, language, msPerChar });
    },
    regionPoint: regionId => {
      const found = region(regionId);
      return found ? regionCenter(found, groundHeight) : null;
    },
    setHighlight: (regionId, on) => {
      const found = on ? regionCells(regionId) : null;
      if (found) state.highlights.set(regionId, found);
      else state.highlights.delete(regionId);
      state.glints = [...state.highlights.values()].map(glintCells => ({ cells: glintCells }));
    },
    shotOrbit: shotId => {
      const shot = context.shots.find(candidate => candidate.id === shotId);
      return shot ? shotToOrbit(shot, groundHeight) : null;
    }
  };
};

export const createSequenceRun = (options: SequenceRunOptions) => {
  const { director, ports, presentation, sequence } = options;
  const steps = sequence.steps;
  const state: RunState = {
    actual: new Map(), closing: null, done: false, glints: [], highlights: new Map(),
    look: { fade: 0, fadeColor: "black", letterbox: 0 }, modeOn: false, nextIndex: 0, nowMs: 0, runners: [],
    settled: [], skipArmedUntilMs: -1, timings: []
  };
  const context = createRunContext(state, options);
  state.timings = scheduleSequence(steps, { language: context.language, msPerChar: context.msPerChar });
  presentation.setUi({ lines: speakLines(sequence), speakers: options.context.speakers, speech: null });

  const beginDueSteps = () => {
    while (state.nextIndex < steps.length && state.timings[state.nextIndex]!.startMs <= state.nowMs) {
      const index = state.nextIndex++;
      const runner = createStepRunner(steps[index]!, context);
      state.runners[index] = runner;
      state.settled[index] = false;
      runner.begin(state.timings[index]!.startMs);
    }
  };

  const updateRunners = () => {
    state.runners.forEach((runner, index) => {
      if (state.settled[index]) return;
      runner.update(state.nowMs);
      if (runner.settled(state.nowMs)) state.settled[index] = true;
    });
  };

  const allStepsDone = () => state.nextIndex === steps.length && state.settled.every(Boolean) &&
    state.timings.every(timing => timing.endMs <= state.nowMs);

  const finishRun = (skipped: boolean) => {
    if (state.done) return;
    state.done = true;
    director.reset();
    state.highlights.clear();
    state.glints = [];
    context.mode.exit();
    presentation.reset();
    ports.world.endSequence(sequence.id, skipped);
  };

  const updateClosing = () => {
    if (!state.closing && allStepsDone()) {
      if (!state.modeOn) {
        finishRun(false);
        return;
      }
      state.closing = createAutoCloseRunner(context, AUTO_CLOSE_MS);
      state.closing.begin(state.nowMs);
    }
    if (!state.closing) return;
    state.closing.update(state.nowMs);
    if (state.closing.settled(state.nowMs)) finishRun(false);
  };

  const updateSkipPrompt = () => {
    if (state.skipArmedUntilMs >= 0 && state.nowMs >= state.skipArmedUntilMs) {
      state.skipArmedUntilMs = -1;
      presentation.setUi({ skipPrompt: false });
    }
  };

  /** Skip to the end state: every step's end is put in place, then the world port applies the rest (CIN4). */
  const skip = () => {
    if (state.done) return;
    steps.forEach((step, index) => {
      const runner = state.runners[index];
      if (runner) runner.finish(true);
      else createStepRunner(step, context).finish(false);
    });
    state.closing?.finish(true);
    finishRun(true);
  };

  const update = (deltaMs: number) => {
    if (state.done) return;
    state.nowMs += deltaMs;
    beginDueSteps();
    updateRunners();
    updateClosing();
    updateSkipPrompt();
    if (!state.done) presentation.setVisual(state.look.fade, state.look.letterbox);
    if (state.look.fadeColor !== presentation.ui.getSnapshot().fadeColor && !state.done)
      presentation.setUi({ fadeColor: state.look.fadeColor });
  };

  /** The newest playing speak line, if any. */
  const speakingRunner = () => {
    const speech = presentation.ui.getSnapshot().speech;
    if (!speech || speech.phase !== "playing") return null;
    const line = speakLines(sequence)[speech.lineIndex];
    const index = line ? steps.indexOf(line) : -1;
    return index >= 0 ? state.runners[index] ?? null : null;
  };

  return {
    /** Click / Space / Enter: advances the shown speak page; false when no line is playing. */
    advance: () => {
      const runner = speakingRunner();
      if (!runner?.advance) return false;
      runner.advance(state.nowMs);
      return true;
    },
    arrived: (stepId: string) => {
      const index = steps.findIndex(step => step.id === stepId);
      if (index >= 0 && index < state.nextIndex) state.runners[index]?.arrive?.(state.nowMs);
    },
    done: () => state.done,
    frame: (): CinematicFrame | undefined => {
      const camera = director.frame(state.nowMs);
      if (!camera.camera && !camera.shake && state.glints.length === 0) return undefined;
      return { ...camera, glints: state.glints };
    },
    holdsWorld: () => !state.done && sequence.pauseWorld,
    locksInput: () => !state.done && state.modeOn,
    nowMs: () => state.nowMs,
    /** Escape (or Space without a line): the first press arms the prompt, the second within 3 s skips. */
    pressSkip: () => {
      if (!state.modeOn || state.done) return;
      if (state.skipArmedUntilMs >= 0) {
        skip();
        return;
      }
      state.skipArmedUntilMs = state.nowMs + SKIP_CONFIRM_MS;
      presentation.setUi({ skipPrompt: true });
    },
    skip,
    update
  };
};

export type SequenceRun = ReturnType<typeof createSequenceRun>;
