import { cartCentreBehind, HANDCART } from "../../render-common/logistics/handcart-rules";
import { HANDCART_LOGISTICS } from "../balance/economy";
import { DMath } from "../math/deterministic-math";
import { SAWMILL_TYPE_ID } from "./building-type-ids";
import { exitPath } from "./settlement-entrance";
import { canCrewCart, CART_EXIT_PHASE, crewForCart } from "./settlement-handcart-crew";
import { hasCartRoom, isCompletedStorage } from "./settlement-handcart-ledger";
import { isGroundSegmentClear } from "./settlement-navigation";
import { servesBuildingEconomy } from "./settlement-ownership";
import { setActorPath } from "./settlement-paths";
import type {
  ProductionRule,
  SettlementBuilding,
  SettlementContext,
  SettlementPoint
} from "./settlement-types";

/**
 * The Sawmill switches between planks and hand carts (owner, 2026-10-13), like the Shipyard's
 * boats/ships toggle. A cart costs its logistics cost in logs; the finished cart waits in the
 * yard (`building.handcarts`) until a carrier of the nearest storage with room pulls it home.
 */
export type SawmillMode = "planks" | "handcart";

/** A waiting cart's centre beside the road centre: half the road plus half the cart and a margin. */
const YARD_SIDE_OFFSET = .8;
/** Its shafts end this far from the road centre, where the puller still stands on the road. */
const YARD_HITCH_OFFSET = .2;

/** Carriers keep this many of each input in stock. */
const BASE_INPUT_STOCK = 2;

const HANDCART_INPUTS = Object.entries(HANDCART_LOGISTICS.cost)
  .flatMap(([ware, count]) => Array.from({ length: count }, () => ware));

export const sawmillMode = (building: SettlementBuilding): SawmillMode =>
  building.handcartMode ? "handcart" : "planks";

export const setSawmillMode = (building: SettlementBuilding | undefined, mode: SawmillMode) => {
  if (building?.typeId !== SAWMILL_TYPE_ID) return false;
  building.handcartMode = mode === "handcart" || undefined;
  return true;
};

export const isCraftingHandcarts = (building: SettlementBuilding) =>
  building.typeId === SAWMILL_TYPE_ID && building.handcartMode === true;

/** One cart cycle fetches every log of the cart's cost; planks keep the ordinary rule. */
export const handcartCycleRule = (rule: ProductionRule): ProductionRule => ({ ...rule, inputs: HANDCART_INPUTS });

/** Input stock a building asks carriers for: a cart-building Sawmill needs a whole cart's logs. */
export const productionInputStock = (building: SettlementBuilding, ware: string) =>
  isCraftingHandcarts(building) ? Math.max(BASE_INPUT_STOCK, HANDCART_LOGISTICS.cost[ware] ?? 0) : BASE_INPUT_STOCK;

/** A new cart starts only when the yard is empty and some storage can still keep one more. */
export const canCraftHandcart = (context: SettlementContext, sawmill: SettlementBuilding) =>
  !(sawmill.handcarts ?? 0) && context.buildings.some(storage =>
    isCompletedStorage(storage) && servesBuildingEconomy(context, storage, sawmill) && hasCartRoom(context, storage));

export const finishHandcart = (sawmill: SettlementBuilding) => {
  sawmill.handcarts = (sawmill.handcarts ?? 0) + 1;
};

const nearestCrewedStorage = (context: SettlementContext, sawmill: SettlementBuilding) => {
  const point = sawmill.access;
  let best: { distance: number; storage: SettlementBuilding } | undefined;
  for (const storage of context.buildings) {
    if (!isCompletedStorage(storage) || !servesBuildingEconomy(context, storage, sawmill) ||
      !hasCartRoom(context, storage) || !canCrewCart(context, storage)) continue;
    const distance = DMath.hypot(storage.access.x - point.x, storage.access.z - point.z);
    if (!best || distance < best.distance) best = { distance, storage };
  }
  return best?.storage;
};

/** The point `distance` along a polyline (its last point when the line is shorter). */
const pointAlong = (points: readonly SettlementPoint[], distance: number) => {
  let left = distance;
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1]!, end = points[index]!;
    const length = DMath.hypot(end.x - start.x, end.z - start.z);
    if (length >= left) {
      const fraction = left / length;
      return { x: start.x + (end.x - start.x) * fraction, z: start.z + (end.z - start.z) * fraction };
    }
    left -= length;
  }
  return points.at(-1)!;
};

/** Free ground: on the map, walkable, and not on a building plot. */
const isOpenGround = (context: SettlementContext, point: SettlementPoint) => {
  const { world } = context.options;
  const x = Math.floor(point.x), z = Math.floor(point.z);
  if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) return false;
  const cell = z * world.cellsX + x;
  // 1 marks a building plot; 2 its flag cell, which a cart may stand on.
  return context.occupied[cell] !== 1 && world.walkCost[cell]! > 0;
};

/**
 * A cart beside the road at `side` (+1 / -1) of the flag, angled so its shafts reach back onto
 * the road: the puller takes them standing at the flag, on the road network.
 */
const roadsideBay = (
  context: SettlementContext,
  access: SettlementPoint,
  along: { x: number; z: number },
  side: number
) => {
  const outward = { x: along.z * side, z: -along.x * side };
  const sine = (YARD_SIDE_OFFSET - YARD_HITCH_OFFSET) / HANDCART.carrierOffset;
  const cosine = Math.sqrt(1 - sine * sine);
  const forward = { x: along.x * cosine - outward.x * sine, z: along.z * cosine - outward.z * sine };
  const hitch = { x: access.x + outward.x * YARD_HITCH_OFFSET, z: access.z + outward.z * YARD_HITCH_OFFSET };
  const yaw = DMath.atan2(forward.x, forward.z);
  const centre = cartCentreBehind(hitch.x, hitch.z, yaw);
  const rear = cartCentreBehind(centre.x, centre.z, yaw);
  const clear = [centre, hitch, rear].every(point => isOpenGround(context, point)) &&
    isGroundSegmentClear(context, access, hitch) && isGroundSegmentClear(context, rear, hitch);
  return clear ? { ...centre, yaw } : null;
};

/**
 * The finished cart waits beside the road at the Sawmill's flag (off the carriers' way), its
 * shafts pointing along the road home; with no free roadside it stands on the road itself.
 */
const yardBay = (context: SettlementContext, sawmill: SettlementBuilding, route: readonly SettlementPoint[]) => {
  const hitch = pointAlong(route, HANDCART.carrierOffset);
  const length = DMath.hypot(hitch.x - sawmill.access.x, hitch.z - sawmill.access.z) || 1;
  const along = { x: (hitch.x - sawmill.access.x) / length, z: (hitch.z - sawmill.access.z) / length };
  const yaw = DMath.atan2(along.x, along.z);
  return roadsideBay(context, sawmill.access, along, 1) ?? roadsideBay(context, sawmill.access, along, -1) ??
    { ...cartCentreBehind(hitch.x, hitch.z, yaw), yaw };
};

/** A carrier leaves the storage, walks to the Sawmill and pulls the new cart home. */
const sendCarrierForCart = (
  context: SettlementContext,
  sawmill: SettlementBuilding,
  storage: SettlementBuilding,
  route: readonly SettlementPoint[]
) => {
  const actor = crewForCart(context, storage);
  sawmill.handcarts = sawmill.handcarts! - 1;
  actor.home = storage.uid;
  actor.building = storage.uid;
  actor.handcart = { cargo: 0, owner: storage.uid, parked: yardBay(context, sawmill, route), state: "parked" };
  setActorPath(actor, exitPath(storage), CART_EXIT_PHASE);
};

/** Runs with the delivery scheduler: every finished cart is fetched once a storage can take it. */
export const collectFinishedHandcarts = (context: SettlementContext) => {
  for (const sawmill of context.buildings) {
    if (sawmill.typeId !== SAWMILL_TYPE_ID || !(sawmill.handcarts ?? 0)) continue;
    const storage = nearestCrewedStorage(context, sawmill);
    const route = storage && context.options.roads.route(sawmill.access, storage.access);
    if (route && route.points.length > 1) sendCarrierForCart(context, sawmill, storage, route.points);
    else sawmill.status = "Hand cart waiting for a storage with room";
  }
};
