import type { StandingAction } from "../../render-common/workers/worker-unit";
import type { SettlementActor } from "../../shared/settlement/settlement-types";

type FisherActor = Pick<SettlementActor, "action" | "job" | "phase" | "timer" | "ware" | "wareTransfer" | "wareUnits">;

/** Land actions are presentation-only; simulation ownership and timings remain untouched. */
export const fisherBoatLandAction = (actor: FisherActor): StandingAction | undefined => {
  if (actor.wareTransfer) return undefined;
  if (actor.phase === "fisherBoatLift") return "boat_lift";
  if (actor.phase === "fisherBoatLaunch") return "boat_launch";
  if (actor.phase === "fisherBoatBeach") return actor.timer < 1 ? "fish_basket_pickup" : "boat_beach";
  if (actor.ware === "boat" && ["carry", "idle"].includes(actor.action)) return "carry_overhead_boat";
  return undefined;
};

export const fisherBasketVisible = (actor: FisherActor) => actor.job === "Fisher" && (
  actor.ware === "fish" && actor.wareUnits === 4 || actor.phase === "fisherBoatBeach" && actor.timer < 1
);
