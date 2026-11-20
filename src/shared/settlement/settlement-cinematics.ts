import type { ActiveCinematic } from "../../../../island-of-settlers-shared/src/script/types/run-state";
import type { SettlementContext } from "./settlement-types";

/**
 * The cinematic boundary of the simulation (CIN4, cinematics plan §3.4). The sequence queue and the active sequence
 * are saved script run state; the presentation player sends the two recorded commands. A held sequence ("Pause the
 * world") advances no tick, so its commands apply at the hold tick and the script engine drains their events and
 * woken runs at once (trigger design §6.3 m4). Replay, verifier and reload apply them identically.
 */

type ScriptEngine = NonNullable<SettlementContext["script"]>["engine"];

const holds = (engine: ScriptEngine) => engine.activeCinematic()?.hold ?? false;

/** Runs a cinematic command; while a sequence held the world before or after it, the engine drains at once. */
const applyHeld = (context: SettlementContext, command: (engine: ScriptEngine) => boolean) => {
  const engine = context.script?.engine;
  if (!engine) return false;
  const heldBefore = holds(engine);
  const accepted = command(engine);
  if (accepted && (heldBefore || holds(engine))) engine.drainPending();
  return accepted;
};

export const createSimulationCinematics = (context: SettlementContext) => ({
  /** Recorded: the playing sequence's next world step; false when stale, out of order or not a world step. */
  applyCinematicStep: (sequenceId: string, stepId: string) =>
    typeof sequenceId === "string" && typeof stepId === "string" &&
    applyHeld(context, engine => engine.applyCinematicStep(sequenceId, stepId)),
  /** The playing sequence (saved run state), or null; read-only for the presentation. */
  activeCinematic: (): Readonly<ActiveCinematic> | null => context.script?.engine.activeCinematic() ?? null,
  /** True while the playing sequence pauses the world: the island frame advances no game time. */
  cinematicHold: () => context.script?.engine.activeCinematic()?.hold ?? false,
  /** Recorded: the playing sequence ended (watched, skipped or reload); its remaining world steps apply in order. */
  endCinematic: (sequenceId: string, skipped: boolean) =>
    typeof sequenceId === "string" && typeof skipped === "boolean" &&
    applyHeld(context, engine => engine.endCinematic(sequenceId, skipped))
});
