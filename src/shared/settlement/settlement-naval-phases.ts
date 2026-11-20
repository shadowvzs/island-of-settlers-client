import { RUN_SPEED } from "../../render-common/workers/worker-gait";
import type { SettlementActor } from "./settlement-types";

/** Phases with a passenger on a ship's deck or its pier (posed with the ship, not on the ground). */
export const NAVAL_DECK_PHASES: readonly string[] = ["navalBoarding", "navalDeckWalk", "navalAboard", "navalDisembark"];
/** A passenger's way between the harbour door and the ship's deck, aboard and ashore. */
const NAVAL_PASSAGE_PHASES = new Set(["navalToShip", "navalBoarding", "navalDeckWalk", "navalDisembark",
  "navalLanding", "navalLandingEnter"]);
/**
 * Soldiers run from the harbour over the pier to the deck and back ashore (owner, 2026-10-20, NAV-04), at the
 * workers' run speed (the run clip); other passengers walk (undefined: the walker's own speed).
 */
export const navalPassageRunSpeed = (actor: Pick<SettlementActor, "job" | "phase">) =>
  actor.job === "Soldier" && NAVAL_PASSAGE_PHASES.has(actor.phase) ? RUN_SPEED : undefined;
