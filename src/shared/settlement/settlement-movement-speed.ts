import { CARRIER_WALK_SPEED, HANDCART_LOGISTICS, WORKER_WALK_SPEED } from "../balance/economy";
import { navalPassageRunSpeed } from "./settlement-naval-phases";
import { actorEconomyOwnerOf } from "./settlement-ownership";
import { settlementRoadSpeedAt } from "./settlement-road-speed";
import { carrierSpeedFactor } from "./settlement-talents";
import type { SettlementActor, SettlementContext } from "./settlement-types";

/** Walking speed on foot, with a cart or leading a horse. Shared by fixed and event movement. */
export const actorGroundSpeed = (context: SettlementContext, actor: SettlementActor) => {
  if (actor.job === "Soldier")
    return navalPassageRunSpeed(actor) ?? context.military?.movementSpeed?.(actor) ?? WORKER_WALK_SPEED;
  if (actor.handcart?.state === "hitched" || actor.job === "Carrier") {
    const carrier = CARRIER_WALK_SPEED * carrierSpeedFactor(context, actorEconomyOwnerOf(context, actor));
    return actor.handcart?.state === "hitched" ? carrier * HANDCART_LOGISTICS.speedFactor : carrier;
  }
  return WORKER_WALK_SPEED;
};

/** Road multiplier applied only to carriers and mounts, matching the fixed-tick path. */
export const actorRoadSpeed = (context: SettlementContext, actor: SettlementActor) =>
  ["Carrier", "Mount"].includes(actor.job) ? settlementRoadSpeedAt(context, actor) : 1;
