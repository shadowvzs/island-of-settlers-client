import { DMath } from "../math/deterministic-math";
import type { MilitaryCombatant } from "./military-combat-rules";
import { militaryGroundPath } from "./military-routing";
import { gatherSlot } from "./settlement-adventure-landing";
import type { CombatCore } from "./settlement-combat-core";
import { isMountedNavigationClear } from "./settlement-navigation";
import { setActorPath } from "./settlement-paths";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

/** Legacy landing riders are repaired only while still near the beach, outside field battles. */
const LANDING_DEPARTURE_RADIUS = 16;
/** Fewer horse-clear cells than this around a rider: it is hemmed in and leads its horse out on foot. */
const HEMMED_POCKET = 40;

/** A legacy beach rider of the player's landing party, still near the gangway. */
const isLandingRider = (context: SettlementContext, actor: SettlementActor, state: MilitaryCombatant) => {
  const landing = context.adventure?.save()?.landing;
  return actor.home === -1 && state.faction === 0 && landing !== undefined && DMath.hypot(
    actor.x - landing.gangway.shore.x, actor.z - landing.gangway.shore.z) <= LANDING_DEPARTURE_RADIUS;
};

/**
 * The rider stands in a pocket a horse cannot leave (houses built round it, a narrow street): the
 * ground a horse can reach from here, flooded cell by cell, runs out within `HEMMED_POCKET` cells.
 */
const isHemmedIn = (context: SettlementContext, actor: SettlementActor) => {
  const { cellsX, cellsZ } = context.options.world;
  const start = Math.floor(actor.z) * cellsX + Math.floor(actor.x);
  const seen = new Set([start]), open = [start];
  const clear = (cell: number) => isMountedNavigationClear(context,
    { x: cell % cellsX + .5, z: Math.floor(cell / cellsX) + .5 });
  if (!clear(start)) return true;
  while (open.length && seen.size < HEMMED_POCKET) {
    const cell = open.pop()!, x = cell % cellsX, z = Math.floor(cell / cellsX);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, nz = z + dz, next = nz * cellsX + nx;
      if (nx < 0 || nz < 0 || nx >= cellsX || nz >= cellsZ || seen.has(next) || !clear(next)) continue;
      seen.add(next); open.push(next);
    }
  }
  return seen.size < HEMMED_POCKET;
};

/** Riders getting on and off their horses when a mounted way on opens or is missing. */
export const createCombatMounting = ({ context, marches, mountChecks, soldiers }: CombatCore) => {
  /** A horse needs a way onward, not just enough room to stand in an isolated clearing. */
  const tryMountOnRoute = (actor: SettlementActor, state: MilitaryCombatant) => {
    if (!isMountedNavigationClear(context, actor)) return false;
    const landingRider = actor.home === -1 && state.faction === 0 && context.adventure?.save()?.landing;
    const goal = state.destination ?? (landingRider
      ? gatherSlot(context, landingRider.gangway.shore, 0) : undefined);
    const previous = mountChecks.get(actor.uid);
    if (previous && DMath.hypot(actor.x - previous.point.x, actor.z - previous.point.z) < 1 &&
      previous.goal?.x === goal?.x && previous.goal?.z === goal?.z) return false;
    mountChecks.set(actor.uid, { goal: goal && { ...goal }, point: { x: actor.x, z: actor.z } });
    const path = goal && militaryGroundPath(context, actor, goal, true);
    if (goal && !path) return false;
    actor.mounted = true; state.dismounted = undefined; state.mountOnClear = undefined;
    marches.forget(actor.uid); state.routeAge = 0;
    if (path && state.destination) setActorPath(actor, path, "militaryField");
    mountChecks.delete(actor.uid);
    return true;
  };
  /**
   * A rider with no mounted way to its goal leads its horse on foot and mounts again where a horse
   * can go on, but only out of a foot-only landing or out of a pocket a horse cannot leave (the
   * "isolated city cavalry"); otherwise a foot-only order is refused.
   */
  const prepareLedDeparture = (actor: SettlementActor, goal: SettlementPoint) => {
    const mountedPath = militaryGroundPath(context, actor, goal, Boolean(actor.mounted));
    if (mountedPath || !actor.mounted) return mountedPath;
    const state = soldiers.get(actor.uid)?.combat;
    if (state?.type !== "cavalry" || (!isLandingRider(context, actor, state) && !isHemmedIn(context, actor))) {
      return null;
    }
    const path = militaryGroundPath(context, actor, goal);
    if (!path) return null;
    actor.mounted = false; state.dismounted = true; state.mountOnClear = true;
    if (!state.destination) { state.destination = { ...goal }; state.order = "move"; }
    mountChecks.delete(actor.uid); marches.forget(actor.uid);
    return path;
  };
  return { prepareLedDeparture, tryMountOnRoute };
};
