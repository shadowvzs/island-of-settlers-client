/**
 * CIN3 sequence player (plan sections 3.2 and 3.5): one sequence at a time from a FIFO queue, victory/defeat
 * preempting, advanced by the render loop with a clamped delta. A hidden tab draws no frames, so the player waits;
 * the first frame after a long hide advances it by at most MAX_FRAME_SECONDS (no fast-forward).
 */
import type { CinematicSequence } from "../../../../../island-of-settlers-shared/src/campaign/cinematics/types";
import { createCameraDirector } from "./camera-director";
import { MAX_FRAME_SECONDS, MS_PER_SECOND, SEQUENCE_PRIORITY } from "./constants";
import type { CinematicPlayerPorts, CinematicSequenceContext } from "./ports";
import { type CinematicPresentation,createCinematicPresentation } from "./presentation";
import { createSequenceRun, type SequenceRun } from "./sequence-run";

export type SequencePriority = (typeof SEQUENCE_PRIORITY)[keyof typeof SEQUENCE_PRIORITY];

interface QueuedSequence {
  context: CinematicSequenceContext;
  priority: SequencePriority;
  sequence: CinematicSequence;
}

/** Real seconds of one frame on the presentation clock, in milliseconds. */
export const presentationDeltaMs = (deltaSeconds: number) =>
  Math.min(MAX_FRAME_SECONDS, Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0)) * MS_PER_SECOND;

export const createSequencePlayer = (
  ports: CinematicPlayerPorts,
  presentation: CinematicPresentation = createCinematicPresentation()
) => {
  const director = createCameraDirector();
  let queue: QueuedSequence[] = [];
  let current: { priority: SequencePriority; run: SequenceRun; sequenceId: string } | null = null;

  const startNext = () => {
    while (!current && queue.length > 0) {
      const next = queue.shift()!;
      const run = createSequenceRun({ context: next.context, director, ports, presentation, sequence: next.sequence });
      current = { priority: next.priority, run, sequenceId: next.sequence.id };
      // Steps at 0 ms (cinematic mode on) start at once, so input locks in the frame the sequence starts.
      run.update(0);
      if (run.done()) current = null;
    }
  };

  const settleCurrent = () => {
    if (!current?.run.done()) return;
    current = null;
    startNext();
  };

  const outcomePending = () => current?.priority === SEQUENCE_PRIORITY.outcome ||
    queue.some(entry => entry.priority === SEQUENCE_PRIORITY.outcome);

  /**
   * Queues a sequence. Victory/defeat (`outcome`) skips the active story sequence (applying its world steps) and
   * drops pending story sequences; a story sequence arriving once an outcome is due is dropped (false).
   */
  const play = (
    sequence: CinematicSequence,
    context: CinematicSequenceContext,
    priority: SequencePriority = SEQUENCE_PRIORITY.story
  ) => {
    if (priority === SEQUENCE_PRIORITY.story && outcomePending()) return false;
    if (priority === SEQUENCE_PRIORITY.outcome) {
      queue = queue.filter(entry => entry.priority === SEQUENCE_PRIORITY.outcome);
      if (current && current.priority !== SEQUENCE_PRIORITY.outcome) current.run.skip();
    }
    queue.push({ context, priority, sequence });
    if (current?.run.done()) current = null;
    startNext();
    return true;
  };

  return {
    active: () => current !== null,
    /** Click / Space / Enter on a speak line. */
    advance: () => {
      const consumed = current?.run.advance() ?? false;
      settleCurrent();
      return consumed;
    },
    /** Skips the active sequence and empties the queue (island teardown). */
    clear: () => {
      queue = [];
      current?.run.skip();
      current = null;
    },
    frame: () => current?.run.frame(),
    holdsWorld: () => current?.run.holdsWorld() ?? false,
    locksInput: () => current?.run.locksInput() ?? false,
    /** CIN4: a walk step's actor arrived (its arrival event). */
    notifyArrived: (stepId: string) => current?.run.arrived(stepId),
    play,
    presentation,
    pressSkip: () => {
      current?.run.pressSkip();
      settleCurrent();
    },
    /** Skip to the end state now (a reload is the same skip, applied by CIN4 from the saved run state). */
    skip: () => {
      current?.run.skip();
      settleCurrent();
    },
    state: () => ({ nowMs: current?.run.nowMs() ?? 0, pending: queue.map(entry => entry.sequence.id),
      sequenceId: current?.sequenceId ?? null }),
    update: (deltaSeconds: number) => {
      if (!current) return;
      current.run.update(presentationDeltaMs(deltaSeconds));
      settleCurrent();
    }
  };
};

export type SequencePlayer = ReturnType<typeof createSequencePlayer>;
