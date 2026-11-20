import type { SettlementScript } from "../shared/script-world/settlement-script";
import type { EnvironmentController } from "./environment-controller";

/** What the follower reads of the running settlement: its map script and the frame's share of the next tick. */
interface FollowedSimulation {
  script: () => SettlementScript | undefined;
  tickFraction: () => number;
}

/**
 * ENV0 (trigger design §6.11): on an island whose map script reads the hour or the weather, the presentation
 * clock and weather follow the simulation's world environment every frame (interpolated between ticks); elsewhere
 * the controller stays the viewer's own (Settings, day mode). Read-only: nothing flows back into the simulation.
 * `heldTicks` (CIN4): real time a held cinematic sequence has played, so an hour change it started is shown.
 */
export const followWorldEnvironment = (
  environment: Pick<EnvironmentController, "followWorld">, simulation: FollowedSimulation | undefined,
  heldTicks = 0
) => {
  const reading = simulation?.script()?.environmentReading(simulation.tickFraction(), heldTicks);
  environment.followWorld(reading ?? null);
};

/** The Settings time and weather controls are locked while the island has a world environment. */
export const isWorldEnvironmentLocked = (simulation: FollowedSimulation | undefined) =>
  simulation?.script()?.environment !== undefined;
