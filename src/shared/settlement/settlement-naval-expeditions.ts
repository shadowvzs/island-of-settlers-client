import { getBuildingDefinition } from "../../render-common/buildings/building-catalog";
import { DMath } from "../math/deterministic-math";
import { harbourSpotAt, storedHarbourSpots } from "./harbour-spot-index";
import { removeSettlementBuilding } from "./settlement-demolition";
import { hasPlayerBuildingOnLandmass } from "./settlement-landmass";
import type { NavalExpedition,NavalFoundingSite } from "./settlement-naval-fleet";
import { claimBuilding, makeBuilding, placementReason } from "./settlement-placement";
import { findCoastalWorkSite, findCoastalWorkSiteAt } from "./settlement-sea-navigation";
import { createShipRoutePlanner } from "./settlement-ship-routes";
import type { Goods, SettlementBuilding, SettlementContext } from "./settlement-types";

/** Expedition supplies stay aboard until the founding site consumes or settles each physical receipt. */
export const createNavalExpeditions = (context: SettlementContext, sea: Uint8Array) => {
  const navigation = createShipRoutePlanner(context.options.world, sea);
  const draft = (point: { x: number; z: number; rotation: number }) => {
    const next = context.nextBuilding;
    const building = makeBuilding(context, 39, point.x, point.z, point.rotation);
    context.nextBuilding = next;
    return building;
  };
  /** HARBOUR-SPOTS: a stored spot's own shore cell first; the full coast search only when it fails. */
  const landingCoast = (building: SettlementBuilding) => {
    const spot = harbourSpotAt(context.options.world, building.x, building.z, building.rotation);
    return (spot && findCoastalWorkSiteAt(context, building, sea, spot.land, 8, navigation.masks.turning)) ??
      findCoastalWorkSite(context, building, sea, new Set(), 8, navigation.masks.turning);
  };
  const site = (point: { x: number; z: number; rotation: number }) => {
    if (!point || ![point.x, point.z, point.rotation].every(Number.isFinite)) return null;
    const building = draft(point);
    if (hasPlayerBuildingOnLandmass(context, building) || placementReason(context, building)) return null;
    const coast = landingCoast(building);
    return coast && { ...point, water: coast.water };
  };
  /** Coarse whole-map footprint scan: only for maps without stored harbour spots. */
  const scanPoints = function* () {
    const { world } = context.options;
    const [width, depth] = getBuildingDefinition(39).gridFootprint;
    for (let z = depth / 2; z < world.cellsZ - depth / 2; z += 3)
      for (let x = width / 2; x < world.cellsX - width / 2; x += 3) yield { x, z, rotation: 0 };
  };
  const destinations = (sourceUid: number) => {
    const source = context.buildings.find(
      (building) =>
        building.uid === sourceUid && building.typeId === 39 && building.construction === 1
    );
    const coast = source && findCoastalWorkSite(context, source, sea, new Set(), 36, navigation.masks.turning);
    if (!coast) return [];
    const result: NavalExpedition[] = [];
    const stored = storedHarbourSpots(context.options.world);
    // Explicit UI query only; never run an island-wide footprint scan on simulation ticks.
    for (const point of stored.length ? stored : scanPoints()) {
      if (
        DMath.hypot(point.x - source.x, point.z - source.z) < 18 ||
        result.some((other) => DMath.hypot(point.x - other.x, point.z - other.z) < 18)
      )
        continue;
      const candidate = site({ x: point.x, z: point.z, rotation: point.rotation });
      if (!candidate || !navigation.route({ ...coast.water, yaw: 0 }, candidate.water)) continue;
      // A new shore settlement needs a landmass with no current-player building (ISL-02).
      if (hasPlayerBuildingOnLandmass(context, candidate)) continue;
      result.push(candidate);
      if (result.length === 8) return result;
    }
    return result;
  };
  const found = (point: NavalExpedition, cargo: Goods, passengers: number[]): NavalFoundingSite | null => {
    if (!point || ![point.x, point.z, point.rotation].every(Number.isFinite) ||
      passengers.length !== 3 ||
      passengers.some(uid => !context.actors.some(actor => actor.uid === uid))) return null;
    const building = draft(point);
    // `point` came from the validated destination list. Recheck the cheap land rules and the exact
    // coast, but do not repeat the full dock search on the landing tick.
    if (hasPlayerBuildingOnLandmass(context, building) ||
      placementReason(context, building, { skipHarbourLaunch: true })) return null;
    building.foundedByExpedition = true;
    context.nextBuilding++;
    claimBuilding(context, building);
    const coast = landingCoast(building);
    if (!coast || coast.water.x !== point.water.x || coast.water.z !== point.water.z) {
      removeSettlementBuilding(context, building);
      return null;
    }
    // The site starts empty: the carrier brings this receipt from the ship and the Leveler
    // prepares the ground before the Builder may use a single construction contact.
    building.status = "Founding harbour: landing crew";
    return { uid: building.uid, remaining: passengers.slice(), shore: { ...coast.land } };
  };
  return { destinations, site, found };
};
