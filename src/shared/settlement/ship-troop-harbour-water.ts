import { SAILING_SHIP_OVERALL_LENGTH } from "../../render-common/ships/ship-dimensions";
import type { ShipSiteFrame } from "../../render-common/ships/ship-frame";
import { DMath } from "../math/deterministic-math";
import { HARBOUR_TYPE_ID } from "./building-type-ids";
import type { FleetBerthing } from "./settlement-naval-berthing";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

interface HarbourWaterOptions {
  berthing: FleetBerthing;
  context: SettlementContext;
  /** The harbours' boat jetties (shuttle landings), drawn as piers into the water. */
  jetties: () => readonly ShipSiteFrame[];
}

/** An anchored troop ship keeps this far (tiles) from berths, jetty ends and the harbour lanes. */
const HARBOUR_WATER_CLEARANCE = SAILING_SHIP_OVERALL_LENGTH;
/** Harbour lanes are checked at points this far apart (tiles). */
const LANE_STEP = 2;

/** Points every `LANE_STEP` tiles along a route. */
const sampleLane = (lane: readonly SettlementPoint[]) => lane.flatMap((point, index) => {
  const previous = lane[index - 1];
  if (!previous) return [point];
  const steps = Math.max(1, Math.ceil(DMath.hypot(point.x - previous.x, point.z - previous.z) / LANE_STEP));
  return Array.from({ length: steps }, (_, step) => ({
    x: previous.x + (point.x - previous.x) * (step + 1) / steps,
    z: previous.z + (point.z - previous.z) * (step + 1) / steps
  }));
});

/**
 * Harbour water a coast anchorage must keep clear of (2026-11-17, seed 123: a pickup ship anchored on a harbour's
 * way out to sea and over its boat jetty): every finished harbour's berths and lanes to the open sea, and every
 * boat jetty's end. Built once per check, since harbours, berths and jetties change between orders.
 */
export const createHarbourWaterGuard = ({ berthing, context, jetties }: HarbourWaterOptions) => {
  const keepClear = (): SettlementPoint[] => {
    const harbours = context.buildings.filter(building =>
      building.typeId === HARBOUR_TYPE_ID && building.construction === 1);
    const berths = harbours.flatMap(harbour => [...berthing.berths.forHarbour(harbour.uid, true)]);
    const lanes = harbours.flatMap(harbour => berthing.lanesFor(harbour.uid).flatMap(sampleLane));
    const jettyEnds = jetties().flatMap(site => site.workPier ? [site.workPier.point, site.workPier.contact] : []);
    return [...berths, ...lanes, ...jettyEnds];
  };
  /** A filter for one search: true for water clear of every harbour's berths, lanes and jetties. */
  const clearWater = () => {
    const points = keepClear();
    return (water: SettlementPoint) => points.every(point =>
      DMath.hypot(point.x - water.x, point.z - water.z) >= HARBOUR_WATER_CLEARANCE);
  };
  return { clearWater };
};
