import { SHIP_DECK } from "../../render-common/ships/ship-deck-layout";
import { deckPeopleSlots, deckSlotPosition } from "../../render-common/ships/ship-deck-people";
import { SAILING_SHIP_SCALE } from "../../render-common/ships/ship-dimensions";
import type { ShipSiteFrame } from "../../render-common/ships/ship-frame";
import type { NavalShip } from "./settlement-naval-fleet";
import { groundPath, moveActor, setActorPath } from "./settlement-paths";
import { advanceShipPier, findShipWorkpoint, type ShipWorkpoint,walkShipDeck } from "./settlement-ship-workpoint";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

export interface FoundingLanding { pier: ShipWorkpoint; paths: { x: number; z: number }[][] }
/** Three landing places just outside the site's access, spread along the wall it faces. */
export const foundingLandingTargets = (
  site: Pick<SettlementBuilding, "access" | "x" | "z">, count: number
) => {
  const dx = site.access.x - site.x, dz = site.access.z - site.z;
  const outward = Math.abs(dx) > Math.abs(dz)
    ? { x: Math.sign(dx), z: 0 } : { x: 0, z: Math.sign(dz) };
  const tangent = { x: -outward.z, z: outward.x };
  return Array.from({ length: count }, (_, index) => {
    const side = (index - (count - 1) / 2) * .65;
    return { x: site.access.x + outward.x + tangent.x * side,
      z: site.access.z + outward.z + tangent.z * side };
  });
};
export const createFoundingLanding = (context: SettlementContext, ship: NavalShip,
  site: SettlementBuilding, crew: readonly number[]): FoundingLanding | null => {
  const pier = findShipWorkpoint(context, site,
    { land: site.access, water: ship, path: [], yaw: ship.yaw }, 12, 36, 12,
    ship.y + SHIP_DECK.floorY * SAILING_SHIP_SCALE, true);
  if (!pier) return null;
  const targets = foundingLandingTargets(site, crew.length);
  const paths = crew.map((_uid, index) => groundPath(context, pier.shore, targets[index]!, site.uid));
  if (paths.some(path => !path)) return null;
  const slots = deckPeopleSlots(crew.length);
  for (const [index, uid] of crew.entries()) {
    const actor = context.actors.find(candidate => candidate.uid === uid), slot = slots[index];
    if (!actor || !slot) return null;
    Object.assign(actor, deckSlotPosition(ship, slot), { phase: "foundingLandingDeck", visible: true,
      action: "idle", path: [{ ...pier.contact }, { ...pier.point }], pathIndex: 0 });
  }
  return { pier, paths: paths as FoundingLanding["paths"] };
};

/** One file across the actual gangway/ramp; ordinary dry-land navigation begins only at the shore. */
export const advanceFoundingLanding = (context: SettlementContext, landing: FoundingLanding,
  crew: readonly number[], dt: number) => {
  for (const [index, uid] of crew.entries()) {
    const actor = context.actors.find(candidate => candidate.uid === uid);
    if (!actor) return false;
    if (actor.phase === "foundingLanded") continue;
    if (actor.phase === "foundingLandingDeck") {
      if (walkShipDeck(actor, landing.pier.y, dt)) actor.phase = "foundingLandingPier";
    } else if (actor.phase === "foundingLandingPier") {
      if (advanceShipPier(context, actor, landing.pier, true, dt))
        setActorPath(actor, landing.paths[index]!, "foundingLandingGround");
    } else if (actor.phase === "foundingLandingGround" && moveActor(context, actor, dt)) {
      actor.phase = "foundingLanded"; actor.action = "idle";
    }
    return false;
  }
  return true;
};
/** A temporary landing dock: the fixed pier, the gangway and its run to the hull are one approach. */
export const foundingLandingFrame = (id: number, ship: NavalShip, landing: FoundingLanding): ShipSiteFrame => ({
  id: -4_000_000 - id, x: ship.x, y: ship.y, z: ship.z, yaw: ship.yaw, progress: 1,
  kind: "dock", workPier: landing.pier
});
