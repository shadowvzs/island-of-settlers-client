import {
  SAILING_SHIP_OVERALL_BEAM, SAILING_SHIP_OVERALL_LENGTH, SAILING_SHIP_SPACING, SAILING_SHIP_TURN_RADIUS
} from "../../render-common/ships/ship-dimensions";
import { wrapAngle } from "../../render-common/wildlife/nav/nav-steering";
import { DMath } from "../math/deterministic-math";
import { findHarbourDock } from "./settlement-harbour-docks";
import { HARBOUR_LOCAL_SHORE_REACH,harbourPierClearGap } from "./settlement-harbour-pier-geometry";
import { type CoastalWorkSite,findCoastalWorkSite } from "./settlement-sea-navigation";
import { shipHullFitsSea, type ShipObstacle,shipsOverlap } from "./settlement-ship-clearance";
import type { createShipRoutePlanner, ShipDestination } from "./settlement-ship-routes";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * Harbour berths: the water beside a harbour's pier where a ship lies to load and unload. Every
 * harbour has one; it gets a second (owner, 2026-10-14) only where two ships lie close without any
 * overlap of hull, rigging or sails (every nation's visible ship stays inside the shared overall
 * envelope, tests/nation-ships.test.ts), neither pier runs under the other ship, and each berth can
 * be entered and left while the other one is taken. The second lies in line with the first along the
 * shore, bow to stern. Prefer more than a whole ship of clear water between the actual piers;
 * retain the compact safe arrangement when the coast cannot support that wider layout.
 */
type RoutePlanner = ReturnType<typeof createShipRoutePlanner>;

/** Berths are searched this far (tiles) from the harbour's door. */
const BERTH_RADIUS = HARBOUR_LOCAL_SHORE_REACH;
/** A berth lies at least this far out from the shore so the hull has water under it. */
const BERTH_OFFSET = 4;
/** First choice: the pier meets the hull this far (tiles) from its middle, leaving turning room. */
const TURNING_ROOM = 4;
/** Pier samples per tile when checking it stays clear of the other ship. */
const PIER_SAMPLES = 4;
/**
 * Leeway (tiles) beyond touching envelopes: a ship moors within a hair of its berth, and the other
 * berth must still count as free.
 */
const MOORING_LEEWAY = .5;
/** Shifts (tiles) along the first berth's keel tried for the second: nearest first, a few tiles of slack. */
const SECOND_BERTH_SHIFTS = Array.from({ length: 9 }, (_, index) =>
  SAILING_SHIP_OVERALL_LENGTH + SAILING_SHIP_SPACING + MOORING_LEEWAY + index * .5);
/** Bounded wider search; an already-spacious compact candidate is still tried first. */
const WIDE_SECOND_BERTH_SHIFTS = [...SECOND_BERTH_SHIFTS,
  ...Array.from({ length: 4 }, (_, index) => SECOND_BERTH_SHIFTS.at(-1)! + (index + 1) * 2)];
const PREFERRED_PIER_GAP = SAILING_SHIP_OVERALL_LENGTH + SAILING_SHIP_SPACING;
/** A second berth lies this far (tiles) from any other harbour's berth: a ship length and a turning circle. */
const FOREIGN_CLEARANCE = SAILING_SHIP_OVERALL_LENGTH + SAILING_SHIP_SPACING + SAILING_SHIP_TURN_RADIUS * 2;
/** Second-berth candidates whose ways in and out are planned before the search gives up. */
const SECOND_BERTH_TRIES = 6;

const poseOf = (berth: ShipDestination): ShipObstacle => ({ x: berth.x, yaw: berth.yaw ?? 0, z: berth.z });
/** The headings a ship may lie at the berth on (bow either way when its pier works both ways). */
const headingsOf = (berth: ShipDestination) => berth.eitherWay
  ? [poseOf(berth), { ...poseOf(berth), yaw: wrapAngle((berth.yaw ?? 0) + Math.PI) }] : [poseOf(berth)];

/** The point lies under the ship's overall footprint (hull, rigging and sails). */
const underShip = (ship: ShipObstacle, point: SettlementPoint) => {
  const dx = point.x - ship.x, dz = point.z - ship.z;
  const along = dx * DMath.sin(ship.yaw) + dz * DMath.cos(ship.yaw);
  const across = dx * DMath.cos(ship.yaw) - dz * DMath.sin(ship.yaw);
  return Math.abs(along) <= SAILING_SHIP_OVERALL_LENGTH / 2 && Math.abs(across) <= SAILING_SHIP_OVERALL_BEAM / 2;
};

/** The pier from the shore to the hull's side passes under the ship lying at `other`. */
const pierUnder = (from: SettlementPoint, to: SettlementPoint, other: ShipObstacle) => {
  const samples = Math.max(1, Math.ceil(DMath.hypot(to.x - from.x, to.z - from.z) * PIER_SAMPLES));
  for (let sample = 0; sample <= samples; sample++) {
    const t = sample / samples;
    if (underShip(other, { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t })) return true;
  }
  return false;
};

/** Harbour level 3 (saved level 2) unlocks a second berth where the shore allows (owner, 2026-10-21). */
export const SECOND_BERTH_LEVEL = 3;
const hasSecondBerthLevel = (harbour?: { workshopUpgrade?: { level: number } }) =>
  (harbour?.workshopUpgrade?.level ?? 0) + 1 >= SECOND_BERTH_LEVEL;

export const createHarbourBerths = (context: SettlementContext, sea: Uint8Array, planner: RoutePlanner) => {
  const berths = new Map<number, { berths: ShipDestination[]; searched: boolean }>();
  const harbour = (uid: number) => context.buildings.find(building => building.uid === uid);
  const pierOf = (uid: number, pose: ShipObstacle) => findHarbourDock(context, uid, pose)?.workPier ?? null;
  /** A ship may lie at the berth bow either way when the pier reaches its deck both ways. */
  const pierWorksBothWays = (uid: number, site: CoastalWorkSite) =>
    Boolean(pierOf(uid, { ...site.water, yaw: wrapAngle((site.yaw ?? 0) + Math.PI) }));
  const accepts = (uid: number, site: CoastalWorkSite, turningRoom: boolean) => {
    const pose = { ...site.water, yaw: site.yaw ?? 0 }, pier = pierOf(uid, pose);
    if (!pier) return false;
    const dx = site.water.x - pier.shore.x, dz = site.water.z - pier.shore.z;
    if (turningRoom && Math.abs(dx * DMath.cos(pose.yaw) - dz * DMath.sin(pose.yaw)) < TURNING_ROOM) return false;
    return Boolean(planner.offshore(pose));
  };
  const toBerth = (uid: number, site: CoastalWorkSite): ShipDestination =>
    ({ ...site.water, eitherWay: pierWorksBothWays(uid, site), yaw: site.yaw });
  const search = (uid: number, accept: (site: CoastalWorkSite) => boolean) =>
    findCoastalWorkSite(context, harbour(uid)!, sea, new Set(), BERTH_RADIUS, undefined, accept, BERTH_OFFSET);
  const firstBerth = (uid: number) => {
    const site = search(uid, site => accepts(uid, site, true)) ?? search(uid, site => accepts(uid, site, false));
    return site && toBerth(uid, site);
  };
  /**
   * A ship gets into `berth` and back out again while a ship lies at `taken` (its footprint is the
   * same whichever way its bow points).
   */
  const usableBeside = (berth: ShipDestination, taken: ShipDestination) => planner.berthAccess(berth, [poseOf(taken)]);
  /** Two berths whose ships, on every heading they may lie on, never touch each other or the other's pier. */
  const besideEachOther = (uid: number, a: ShipDestination, b: ShipDestination) =>
    headingsOf(a).every(first => headingsOf(b).every(second => {
      if (shipsOverlap(first, second)) return false;
      const firstPier = pierOf(uid, first), secondPier = pierOf(uid, second);
      return Boolean(firstPier && secondPier) && !pierUnder(firstPier!.shore, firstPier!.point, second) &&
        !pierUnder(secondPier!.shore, secondPier!.point, first);
    }));
  /** A working berth `shift` tiles along the first berth's keel (either way), clear of it and its pier. */
  const inLine = (uid: number, first: ShipDestination, shift: number): ShipDestination | null => {
    const pose = poseOf(first);
    const water = { x: pose.x + DMath.sin(pose.yaw) * shift, z: pose.z + DMath.cos(pose.yaw) * shift };
    const candidate = { ...water, yaw: pose.yaw };
    const site = { land: harbour(uid)!.access, path: [], water, yaw: pose.yaw };
    if (!shipHullFitsSea(context.options.world, sea, candidate) || shipsOverlap(pose, candidate)) return null;
    if (!accepts(uid, site, false)) return null;
    const berth = toBerth(uid, site);
    return besideEachOther(uid, first, berth) ? berth : null;
  };
  /** Berths of the other harbours; a second berth keeps well clear of their ships' ways in and out. */
  const foreignBerths = (uid: number) => context.buildings.filter(building => building.uid !== uid &&
    building.typeId === 39 && building.construction === 1).flatMap(building => forHarbour(building.uid));
  /** Interleave eligible candidates, so blocked near candidates on one side cannot consume the
   * entire route budget before the other side's first geometrically eligible berth is tried. */
  const secondCandidates = (uid: number, first: ShipDestination, shifts: readonly number[],
    foreign: readonly ShipDestination[], gap: number) => {
    const firstPier = pierOf(uid, poseOf(first))!;
    const directions = [1, -1].map(sign => shifts.flatMap(shift => {
      const berth = inLine(uid, first, shift * sign);
      if (!berth || foreign.some(other => DMath.hypot(other.x - berth.x, other.z - berth.z) < FOREIGN_CLEARANCE)) return [];
      if (gap && harbourPierClearGap(firstPier, pierOf(uid, poseOf(berth))!) < gap) return [];
      return [berth];
    }));
    return Array.from({ length: Math.max(...directions.map(list => list.length)) }, (_, index) =>
      directions.flatMap(list => list[index] ? [list[index]!] : [])).flat();
  };
  /** A bounded two-sided search, preferring spacious piers before compact safe alternatives. */
  const secondBerth = (uid: number, first: ShipDestination) => {
    const foreign = foreignBerths(uid);
    for (const { gap, shifts } of [
      { gap: PREFERRED_PIER_GAP, shifts: WIDE_SECOND_BERTH_SHIFTS },
      { gap: 0, shifts: SECOND_BERTH_SHIFTS }
    ]) {
      for (const berth of secondCandidates(uid, first, shifts, foreign, gap).slice(0, SECOND_BERTH_TRIES)) {
        if (usableBeside(berth, first) && usableBeside(first, berth)) return berth;
      }
    }
    return null;
  };
  /**
   * The harbour's berths, its first (nearest the pier) first; recomputed when one stops working. The
   * second is searched only once a ship needs it (`busy`): a quiet harbour never pays for the search.
   */
  const forHarbour = (uid: number, busy = false): readonly ShipDestination[] => {
    let known = berths.get(uid);
    if (known && !known.berths.every(berth => pierOf(uid, poseOf(berth)))) { berths.delete(uid); known = undefined; }
    if (!known) {
      const first = harbour(uid) && firstBerth(uid);
      if (!first) return [];
      known = { berths: [first], searched: false };
      berths.set(uid, known);
    }
    if (!busy || known.searched || !hasSecondBerthLevel(harbour(uid))) return known.berths;
    known.searched = true;
    const second = secondBerth(uid, known.berths[0]!);
    if (second) known.berths = [known.berths[0]!, second];
    return known.berths;
  };
  return { clear: () => berths.clear(), forget: (uid: number) => berths.delete(uid), forHarbour };
};
