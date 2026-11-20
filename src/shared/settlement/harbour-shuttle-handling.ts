import { LIGHTER_BEAM } from "../../render-common/ships/lighter-dimensions";
import { DMath } from "../math/deterministic-math";
import type { SettlementPoint } from "./settlement-types";
import { SMALL_BOAT_ROWERS } from "./small-boat-crew";

/** The claimed boatmen carry their own boxes and finish aboard; no extra population is invented. */
export const SHUTTLE_PORTER_SPEED = 1.25;
const HANDLE = .35, STAGGER = .7;
export interface ShuttlePorterPlace {
  /** Transient manifest index of the existing box carried during this stage. */
  box?: number;
  carrying: boolean;
  moving: boolean;
  outward: boolean;
  share: number;
}
export const shuttleRouteLength = (route: readonly SettlementPoint[]) => route.slice(1).reduce((sum, p, i) =>
  sum + DMath.hypot(p.x - route[i]!.x, p.z - route[i]!.z), 0);
const boatSidePoint = (landing: SettlementPoint, jetty: SettlementPoint, offset: number): SettlementPoint => {
  const dx = jetty.x - landing.x, dz = jetty.z - landing.z, distance = DMath.hypot(dx, dz);
  const share = distance ? offset / distance : 0;
  return { x: landing.x + dx * share, z: landing.z + dz * share };
};
/** The carrier stands just outside the gunwale, with toe clearance from the central crate grid. */
export const shuttleBoatContact = (landing: SettlementPoint, jetty: SettlementPoint) =>
  boatSidePoint(landing, jetty, LIGHTER_BEAM / 2 + .05);
/** The board continues beyond that standing point onto the gunwale, leaving no boarding gap. */
export const shuttleGangwayContact = (landing: SettlementPoint, jetty: SettlementPoint) =>
  boatSidePoint(landing, jetty, LIGHTER_BEAM / 2 - .05);

/**
 * Both boatmen walk in the same direction in file. The next leg waits until the last person has
 * arrived, so the narrow deck never needs passing room. Waiting indoors is distinct from aboard.
 * The saved phase clock drives the same schedule as the visible box handoffs and carrier frames.
 */
export const shuttleHandling = (boxes: number, length: number, unloading: boolean, elapsed: number, crew = SMALL_BOAT_ROWERS) => {
  const walk = length / SHUTTLE_PORTER_SPEED;
  const places: (ShuttlePorterPlace | null)[] = Array.from({ length: crew }, () => null);
  const aboard = Array.from({ length: crew }, () => unloading);
  let moved = 0, seconds = 0, roundStart = 0;
  const stage = (porter: number, start: number, duration: number, from: number, to: number,
    carrying: boolean, aboardAfter = false, box?: number) => {
    const end = start + duration;
    if (elapsed >= start) {
      aboard[porter] = false;
      places[porter] = { box, carrying, moving: from !== to, outward: to >= from,
        share: from + (to - from) * Math.max(0, Math.min(1, (elapsed - start) / Math.max(duration, 1e-6))) };
      if (elapsed >= end) { places[porter] = null; aboard[porter] = aboardAfter; }
    }
    seconds = Math.max(seconds, end);
    return end;
  };
  for (let round = 0; round < Math.max(1, Math.ceil(boxes / Math.max(1, crew))); round++) {
    let arrived = roundStart;
    for (let porter = 0; porter < crew; porter++) {
      const hasBox = round * crew + porter < boxes;
      let cursor = roundStart + porter * STAGGER;
      if (!hasBox) {
        // An otherwise idle second boatman still joins his real boat on the first loading walk.
        if (!unloading && !round) arrived = Math.max(arrived,
          stage(porter, cursor + HANDLE, walk, 0, 1, false, true));
        continue;
      }
      const from = unloading ? 1 : 0, to = 1 - from;
      const box = round * crew + porter;
      cursor = stage(porter, cursor, HANDLE, from, from, !unloading, false, box);
      if (unloading && elapsed >= cursor) moved++;
      cursor = stage(porter, cursor, walk, from, to, true, false, box);
      cursor = stage(porter, cursor, HANDLE, to, to, true, !unloading, box);
      if (!unloading && elapsed >= cursor) moved++;
      arrived = Math.max(arrived, cursor);
    }
    let returned = arrived;
    for (let porter = 0; porter < crew; porter++) {
      const hasBox = round * crew + porter < boxes, needsMore = (round + 1) * crew + porter < boxes;
      if (!hasBox || (!unloading && !needsMore)) continue;
      returned = Math.max(returned, stage(porter, arrived + porter * STAGGER, walk,
        unloading ? 0 : 1, unloading ? 1 : 0, false, unloading));
    }
    roundStart = returned;
  }
  return { aboard, boxes: Math.max(0, unloading ? boxes - moved : moved), places, seconds };
};
