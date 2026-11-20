/**
 * CIN4 bridge between the simulation's cinematic state (saved run state: queue, active sequence, hold) and the
 * CIN3 presentation player. The simulation decides which sequence plays; the player shows it and sends the two
 * recorded commands through this world port. A sequence that is active when the island opens (a reload or a crash
 * mid-sequence) is skipped at once: its remaining world steps apply and the player sees the end state (plan §3.5).
 */
import { isCinematicWorldStep } from "../../../../../island-of-settlers-shared/src/script/engine/cinematic-steps";
import type { ActiveCinematic } from "../../../../../island-of-settlers-shared/src/script/types/run-state";
import type { MapScript } from "../../../../../island-of-settlers-shared/src/script/types/script";
import { TICK_MS } from "../../../../../island-of-settlers-shared/src/time/constants";
import { scriptActorSpeakers } from "./actor-speakers";
import type { CinematicSequenceContext, CinematicWorldPort } from "./ports";
import { presentationDeltaMs, type SequencePlayer } from "./sequence-player";

/** The settlement simulation as the bridge uses it (its recorded commands go through the recorder wrapper). */
export interface CinematicWorldSimulation {
  activeCinematic: () => Readonly<ActiveCinematic> | null;
  applyCinematicStep: (sequenceId: string, stepId: string) => boolean;
  cinematicHold: () => boolean;
  endCinematic: (sequenceId: string, skipped: boolean) => boolean;
  script: () => { engine: { script: MapScript }; environment?: unknown } | undefined;
}

type BridgePlayer = Pick<SequencePlayer, "clear" | "notifyArrived" | "play">;

/**
 * The script's named actors speak under their display names. The campaign's own speakers live on the campaign
 * manifest; until it is wired their lines show the speaker panel's initials fallback.
 */
const contextOf = (script: MapScript): CinematicSequenceContext =>
  ({ regions: script.regions, shots: script.cameraShots, speakers: scriptActorSpeakers(script) });

/** Create it when the island opened, before its first frame: the active sequence then is a restored one. */
export const createCinematicWorldBridge = (simulation: () => CinematicWorldSimulation | undefined) => {
  let restored = simulation()?.activeCinematic() ?? null;
  let playing: Readonly<ActiveCinematic> | null = null;
  let heldMs = 0;
  const reported = new Set<string>();

  const activeId = () => simulation()?.activeCinematic()?.sequenceId ?? null;
  const ownsEnvironment = () => simulation()?.script()?.environment !== undefined;
  const isWorldStep: NonNullable<CinematicWorldPort["ownsStep"]> = step =>
    isCinematicWorldStep(step, ownsEnvironment());

  const port: CinematicWorldPort = {
    applyStep: (sequenceId, step) => {
      if (activeId() !== sequenceId || !isWorldStep(step)) return;
      simulation()?.applyCinematicStep(sequenceId, step.id);
    },
    endSequence: (sequenceId, skipped) => {
      if (activeId() === sequenceId) simulation()?.endCinematic(sequenceId, skipped);
    },
    ownsStep: isWorldStep
  };

  /** Reload rule: a sequence already active when the island opened is skipped before it is shown. */
  const skipRestored = (sim: CinematicWorldSimulation) => {
    if (sim.activeCinematic() === restored) sim.endCinematic(restored!.sequenceId, true);
    restored = null;
  };

  const start = (sim: CinematicWorldSimulation, player: BridgePlayer, active: Readonly<ActiveCinematic>) => {
    const script = sim.script()?.engine.script;
    const sequence = script?.sequences.find(entry => entry.id === active.sequenceId);
    if (!script || !sequence) {
      sim.endCinematic(active.sequenceId, true);
      return;
    }
    player.play(sequence, contextOf(script));
  };

  const reportArrivals = (player: BridgePlayer, active: Readonly<ActiveCinematic>) => {
    for (const stepId of active.arrived) {
      if (reported.has(stepId)) continue;
      reported.add(stepId);
      player.notifyArrived(stepId);
    }
  };

  /** Each frame before the player advances: follow the simulation's active sequence. */
  const sync = (player: BridgePlayer) => {
    const sim = simulation();
    if (!sim) return;
    if (restored) skipRestored(sim);
    const active = sim.activeCinematic();
    if (active !== playing) {
      // The previous sequence ended or was preempted in the simulation; its end is not sent again (stale id).
      if (playing) player.clear();
      playing = active;
      reported.clear();
      heldMs = 0;
      if (active) start(sim, player, active);
    }
    if (active) reportArrivals(player, active);
  };

  return {
    /** A simulation sequence is playing (presentation-only players hold only their own world). */
    active: () => playing !== null,
    /** The playing sequence pauses the world (saved run state, so replay and reload agree). */
    holds: () => simulation()?.cinematicHold() ?? false,
    /** Real time the held sequence has played, in ticks (the world environment shows its hour change). */
    heldTicks: () => heldMs / TICK_MS,
    port,
    sync,
    /** After the player's frame: the held real time grows with the same clamped clock as the player. */
    track: (deltaSeconds: number) => {
      if (playing?.hold) heldMs += presentationDeltaMs(deltaSeconds);
    }
  };
};

export type CinematicWorldBridge = ReturnType<typeof createCinematicWorldBridge>;
