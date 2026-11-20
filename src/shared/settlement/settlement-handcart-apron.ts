import { cartCentreBehind, cartHitchPoint, HANDCART, HANDCART_FOOTPRINT } from "../../render-common/logistics/handcart-rules";
import { DMath } from "../math/deterministic-math";
import { ROAD_PLACEMENT_HALF_WIDTH } from "./road-types";
import { isOnStoneRoad } from "./settlement-handcart-roads";
import { isNavigationFootprintClear } from "./settlement-navigation";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

const isCartPoseClear = (context: SettlementContext, puller: SettlementPoint, yaw: number) => {
  const centre = cartCentreBehind(puller.x, puller.z, yaw);
  const cosine = DMath.cos(yaw), sine = DMath.sin(yaw);
  for (let section = 1; section < HANDCART_FOOTPRINT.length; section++) {
    const from = HANDCART_FOOTPRINT[section - 1]!, to = HANDCART_FOOTPRINT[section]!;
    const samples = Math.ceil((to.z - from.z) / .1);
    for (let sample = 0; sample <= samples; sample++) {
      const along = from.z + (to.z - from.z) * sample / samples;
      const halfWidth = from.halfWidth + (to.halfWidth - from.halfWidth) * sample / samples;
      for (const across of [-halfWidth, 0, halfWidth]) {
        const point = { x: centre.x + sine * along + cosine * across,
          z: centre.z + cosine * along - sine * across };
        if (!isNavigationFootprintClear(context, point, undefined, HANDCART.clearance)) return false;
      }
    }
  }
  return true;
};

/** A parked empty cart beside its shed must physically reach the flag before it can be shelved. */
export const canPullCartAcrossStorageApron = (
  context: SettlementContext, actor: SettlementActor, storage: SettlementBuilding
) => {
  const cart = actor.handcart;
  if (!cart || cart.cargo || cart.trip || actor.ware || cart.state !== "parked" || !cart.parked) return false;
  const hitch = cartHitchPoint(cart.parked.x, cart.parked.z, cart.parked.yaw);
  if (DMath.hypot(actor.x - hitch.x, actor.z - hitch.z) > .05) return false;
  const dx = storage.access.x - actor.x, dz = storage.access.z - actor.z;
  const distance = DMath.hypot(dx, dz);
  if (distance > ROAD_PLACEMENT_HALF_WIDTH || !isOnStoneRoad(context, storage.access)) return false;
  const heading = DMath.atan2(dx, dz);
  const turn = DMath.atan2(DMath.sin(heading - cart.parked.yaw), DMath.cos(heading - cart.parked.yaw));
  const steps = Math.max(1, Math.ceil(distance / .1), Math.ceil(Math.abs(turn) / .1));
  for (let step = 0; step <= steps; step++) {
    const fraction = step / steps, yaw = cart.parked.yaw + turn * fraction;
    const puller = { x: actor.x + dx * fraction, z: actor.z + dz * fraction };
    if (!isNavigationFootprintClear(context, puller)) return false;
    if (!isCartPoseClear(context, puller, yaw)) return false;
  }
  return true;
};
