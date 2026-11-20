import type { ShipFrame, ShipSiteFrame, ShuttleBoatFrame } from "../../render-common/ships/ship-frame";
import { CARGO_BOX_WARE,cargoCarryWare } from "../../render-common/wares/ware-catalog";
import { boatJettyFootY } from "../../shared/settlement/harbour-boat-jetty";
import { carrierPlaceAt,CARRIERS_PER_LIGHTER, lighterCarrierCargoIndex } from "../../shared/settlement/harbour-lighters";
import { SHUTTLE_PORTER_SPEED,shuttleHandling, shuttleRouteLength } from "../../shared/settlement/harbour-shuttle-handling";
import type { SettlementActor } from "../../shared/settlement/settlement-types";
import {
  DOCK_PORTER_LANE, DOCK_PORTER_SPEED, porterCargoIndices, porterPlaceAt, porterSpeed, routeLength
} from "../../shared/settlement/ship-cargo-handling";
import { shuttlePersonId } from "../../shared/settlement/small-boat-crew";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";

/** Far above simulation actor ids; porters are visual only and never saved. */
const PORTER_UID = 2_000_000_000;
/** Porter ids per dock (more than the most porters a pier takes). */
const PORTERS_PER_DOCK = 16;
/** The lighters' carriers: their own id range, and their lanes, outside the pier porters' (`DOCK_PORTER_LANE`). */
const LIGHTER_CARRIER_UID = PORTER_UID + 100_000_000;
const LIGHTER_CARRIER_LANE = .5;
const LIGHTER_LANE_STEP = .3;
/** Tiles the second carrier of a boat waits behind the first at the landing. */
const WAITING_STEP = .6;
const porterSpeedOf = (plan: { speed?: number }) => DOCK_PORTER_SPEED * (plan.speed ?? 1);

interface Placement { x: number; z: number; yaw: number; onPier: number }

/**
 * Point at a distance along the route, `lane` tiles to one side of its centre line (negative: the other);
 * `onPier` is 0..1 across the final, pier leg.
 */
const along = (points: readonly { x: number; z: number }[], distance: number, lane: number): Placement => {
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1]!, end = points[index]!;
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    if (distance > length && index < points.length - 1) { distance -= length; continue; }
    const t = length ? Math.min(1, distance / length) : 1;
    const sideX = length ? -(end.z - start.z) / length * lane : 0;
    const sideZ = length ? (end.x - start.x) / length * lane : 0;
    return { onPier: index === points.length - 1 ? t : 0, x: start.x + (end.x - start.x) * t + sideX,
      yaw: Math.atan2(end.x - start.x, end.z - start.z), z: start.z + (end.z - start.z) * t + sideZ };
  }
  const last = points.at(-1)!;
  return { onPier: 1, x: last.x, yaw: 0, z: last.z };
};

/** A porter actor at `spot` (visual only). */
const porterActor = (uid: number, spot: Placement, y: number, ware: string | null, outward: boolean,
  speed: number, elapsed: number) => ({ action: ware ? "carry" : "walk", animationTime: elapsed, building: 0, home: 0,
  job: "Carrier", locomotionSpeed: speed, path: [], pathIndex: 0, phase: "dockPorter", timer: 0, uid, visible: true,
  ware, x: spot.x, y, yaw: outward ? spot.yaw : spot.yaw + Math.PI, z: spot.z }) as SettlementActor;

/**
 * The harbour's carriers at the lighters' landings (NAV-03): two per lighter walk between the harbour door and
 * their boat's landing on their own outer lanes, clear of the pier porters' lanes, a box on the shoulder each
 * way the lighters' plan says (harbour-lighters.ts).
 */
export const lighterCarriers = (world: WorldData, ships: readonly ShipFrame[], extraSeconds = 0) => {
  const carriers: SettlementActor[] = [];
  for (const ship of ships) {
    const work = ship.lighterWork;
    if (!work) continue;
    const elapsed = work.elapsed + extraSeconds;
    for (let index = 0; index < work.plan.lighters * CARRIERS_PER_LIGHTER; index++) {
      const place = carrierPlaceAt(work.plan, index, elapsed, work.unloading);
      const boat = work.boats[Math.floor(index / CARRIERS_PER_LIGHTER)];
      if (!place || !boat) continue;
      // Each landing place's carriers keep to their own lanes; the second waits a step behind the first.
      const length = routeLength(boat.route), lane = LIGHTER_CARRIER_LANE + boat.place * LIGHTER_LANE_STEP;
      const share = Math.min(place.share, 1 - (index % CARRIERS_PER_LIGHTER) * WAITING_STEP / Math.max(length, 1));
      const spot = along(boat.route, share * length, place.outward ? lane : -lane);
      const box = lighterCarrierCargoIndex(work.plan, index, elapsed, work.unloading);
      const cargo = box === undefined ? undefined : work.manifest?.[box];
      const ware = place.carrying ? cargoCarryWare(cargo?.ware ?? CARGO_BOX_WARE) : null;
      carriers.push(porterActor(LIGHTER_CARRIER_UID + ship.id * PORTERS_PER_DOCK + index, spot,
        sampleSmooth(world, world.heights, spot.x, spot.z), ware, place.outward, porterSpeedOf(work.plan), elapsed));
    }
  }
  return carriers;
};

/**
 * Carriers walk harbour door → pier → ship's side and back, a box on the shoulder each way the
 * simulation's porter plan says (ship-cargo-handling.ts): they appear when their first trip starts
 * and go in after their last. `extraSeconds` is the share of the running simulation tick.
 */
export const dockPorters = (world: WorldData, sites: readonly ShipSiteFrame[], extraSeconds = 0) => {
  const porters: SettlementActor[] = [];
  for (const dock of sites) {
    const work = dock.cargoWork;
    if (dock.kind !== "dock" || !dock.workPier || !dock.porterRoute || !work) continue;
    const pier = dock.workPier, points = [...dock.porterRoute, pier.shore, pier.point];
    const length = routeLength(points), elapsed = work.elapsed + extraSeconds;
    for (let index = 0; index < work.plan.porters; index++) {
      const place = porterPlaceAt(work.plan, index, elapsed, work.unloading);
      if (!place) continue;
      // Two lanes: going out on one side of the pier, coming back on the other.
      const spot = along(points, place.share * length, place.outward ? DOCK_PORTER_LANE : -DOCK_PORTER_LANE);
      const ground = sampleSmooth(world, world.heights, spot.x, spot.z);
      const boxes = porterCargoIndices(work.plan, index, elapsed);
      const cargo = boxes.map(box => work.manifest?.[box]?.ware ?? CARGO_BOX_WARE);
      const ware = place.carrying ? cargoCarryWare(cargo[0] ?? CARGO_BOX_WARE, cargo[1]) : null;
      porters.push(porterActor(PORTER_UID + dock.id * PORTERS_PER_DOCK + index, spot,
        spot.onPier ? pier.shoreY * (1 - spot.onPier) + pier.y * spot.onPier : ground, ware, place.outward,
        porterSpeed(work.plan), elapsed));
    }
  }
  return porters;
};

/** Nearby boats use their one finite claimed paddler as carriers, rather than inventing shore crew. */
export const shuttlePorters = (world: WorldData, boats: readonly ShuttleBoatFrame[], extraSeconds = 0) => {
  const result: SettlementActor[] = [];
  for (const boat of boats) {
    const work = boat.porterWork;
    if (!work || work.route.length < 3) continue;
    const length = shuttleRouteLength(work.route), elapsed = work.elapsed + extraSeconds;
    const schedule = shuttleHandling(work.boxes, length, work.unloading, elapsed, work.crew);
    const foot = work.route.at(-3)!, tip = work.route.at(-2)!;
    const shoreLength = shuttleRouteLength(work.route.slice(0, -2));
    const boardLength = Math.hypot(tip.x - foot.x, tip.z - foot.z);
    schedule.places.forEach((place, index) => {
      if (!place) return;
      const distance = place.share * length;
      const spot = along(work.route, distance, place.outward ? .1 : -.1);
      let y = sampleSmooth(world, world.heights, spot.x, spot.z);
      if (distance >= shoreLength) {
        const boardShare = Math.min(1, (distance - shoreLength) / Math.max(.001, boardLength));
        const footY = boatJettyFootY(world, foot, tip);
        y = footY * (1 - boardShare) + (world.seaLevel + .18) * boardShare;
        if (distance > shoreLength + boardLength) {
          const gangway = boat.gangway;
          const span = gangway ? Math.hypot(gangway.to.x - gangway.from.x, gangway.to.z - gangway.from.z) :
            length - shoreLength - boardLength;
          const gangwayShare = Math.min(1, (distance - shoreLength - boardLength) / Math.max(.001, span));
          y = gangway ? gangway.from.y + (gangway.to.y - gangway.from.y) * gangwayShare : world.seaLevel + .24;
        }
      }
      const cargo = place.box === undefined ? undefined : boat.cargoManifest?.[place.box];
      const actor = porterActor(shuttlePersonId(boat.id, index), spot, y,
        place.carrying ? cargoCarryWare(cargo?.ware ?? CARGO_BOX_WARE) : null, place.outward,
        place.moving ? SHUTTLE_PORTER_SPEED : 0, elapsed);
      if (!place.moving) actor.action = place.carrying ? "carry" : "idle";
      result.push(actor);
    });
  }
  return result;
};
