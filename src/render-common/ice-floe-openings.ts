import type { WorldData } from "../shared/world/world-data";
import type { BuildingFrame } from "./buildings/building-catalog";
import type { FishingBoatFrame, ShipFrame, ShuttleBoatFrame } from "./ships/ship-frame";
import type { WorkerFrame } from "./workers/worker-unit";

/**
 * Kept-open water of the winter ice floes (owner decision D-W2): harbours, berths, ship and boat
 * tracks and fishing spots always stay free of floes. One byte per cell (255 = open, a soft rim
 * below): the floe placement avoids it and floes it reaches later leave the mesh. Presentation
 * only: it reads frames and the world layout and never feeds navigation or the simulation.
 *
 * Openings only accumulate during a session: a lead a ship broke stays open, so a lane a ship used
 * once never refreezes under the next ship.
 */
export const ICE_OPENING_RADII = {
  /** Generation harbour plots: berth and turning water. */
  harbourSpot: 9,
  /** A harbour building: piers, berths, lighters and the approach. */
  harbour: 10,
  /** A shipyard: the slipway and the launch water. */
  shipyard: 10,
  /** A fishery: the skiff launch slots and the rod stands next to it. */
  fishery: 8,
  /** A ship's beam plus margin; its track also reaches SHIP_TRACK_REACH fore and aft. */
  ship: 5,
  /** Rowing boats and fishing skiffs. */
  boat: 3,
  /** A rod fisher's cast point. */
  fishingSpot: 3
} as const;

const HARBOUR_TYPE = 39;
const SHIPYARD_TYPE = 36;
const FISHERY_TYPE = 18;
/** Cells the open lead reaches ahead of (and behind) a ship's centre along its heading. */
const SHIP_TRACK_REACH = 8;
/** Cells of the soft rim of an opening (the ice thins out instead of ending at a hard circle). */
const OPENING_FADE = 2;
/** A vessel restamps after moving this far (cells). */
const RESTAMP_DISTANCE = 1;

const BUILDING_RADII: Readonly<Record<number, number>> = {
  [FISHERY_TYPE]: ICE_OPENING_RADII.fishery,
  [HARBOUR_TYPE]: ICE_OPENING_RADII.harbour,
  [SHIPYARD_TYPE]: ICE_OPENING_RADII.shipyard
};

export interface IceFloeOpeningsFrame {
  buildings?: readonly BuildingFrame[];
  fishingBoats?: readonly FishingBoatFrame[];
  ships?: readonly ShipFrame[];
  shuttleBoats?: readonly ShuttleBoatFrame[];
  workers?: readonly WorkerFrame[];
}

export interface IceFloeOpenings {
  height: number;
  pixels: Uint8Array;
  /** Stamps the frame's sites and vessels; true when any byte changed. */
  update: (frame: IceFloeOpeningsFrame) => boolean;
  width: number;
}

interface Vessel { x: number; z: number; yaw?: number }

/** Writes a soft disc into the byte field (max with what is there); true when a byte rose. */
export const stampOpening = (
  pixels: Uint8Array, width: number, height: number, x: number, z: number, radius: number
) => {
  let changed = false;
  const minX = Math.max(0, Math.floor(x - radius)), maxX = Math.min(width - 1, Math.ceil(x + radius));
  const minZ = Math.max(0, Math.floor(z - radius)), maxZ = Math.min(height - 1, Math.ceil(z + radius));
  const inner = Math.max(0, radius - OPENING_FADE);
  for (let cellZ = minZ; cellZ <= maxZ; cellZ += 1) {
    for (let cellX = minX; cellX <= maxX; cellX += 1) {
      const distance = Math.hypot(cellX + 0.5 - x, cellZ + 0.5 - z);
      if (distance >= radius) continue;
      const share = distance <= inner ? 1 : (radius - distance) / (radius - inner);
      const value = Math.round(share * 255);
      const index = cellZ * width + cellX;
      if (value <= pixels[index]!) continue;
      pixels[index] = value;
      changed = true;
    }
  }
  return changed;
};

type IceFloeOpeningsWorld = Pick<WorldData, "cellsX" | "cellsZ" | "playableIslands">;

/** The world's stored harbour plots (generation proof harbours and potential harbour spots). */
const getHarbourSites = (world: IceFloeOpeningsWorld) => (world.playableIslands?.sites ?? []).flatMap(site => [
  { radius: ICE_OPENING_RADII.harbour, x: site.harbour.x, z: site.harbour.z },
  ...(site.harbourSpots ?? []).map(spot => ({ radius: ICE_OPENING_RADII.harbourSpot, x: spot.water.x,
    z: spot.water.z }))
]);

export const createIceFloeOpenings = (world: IceFloeOpeningsWorld): IceFloeOpenings => {
  const width = world.cellsX, height = world.cellsZ;
  const pixels = new Uint8Array(width * height);
  const stamp = (x: number, z: number, radius: number) => stampOpening(pixels, width, height, x, z, radius);
  for (const site of getHarbourSites(world)) stamp(site.x, site.z, site.radius);
  const seenBuildings = new Set<string>();
  const vesselStamps = new Map<string, Vessel>();
  const fishingSpots = new Set<number>();

  const stampBuildings = (buildings: readonly BuildingFrame[]) => {
    let changed = false;
    for (const building of buildings) {
      const radius = BUILDING_RADII[building.type];
      if (radius === undefined || seenBuildings.has(building.id)) continue;
      seenBuildings.add(building.id);
      changed = stamp(building.x, building.z, radius) || changed;
    }
    return changed;
  };

  const stampTrack = (vessel: Vessel, radius: number) => {
    let changed = stamp(vessel.x, vessel.z, radius);
    if (vessel.yaw === undefined) return changed;
    // Fore and aft (yaw conventions differ between hull kinds): the lead runs along the keel.
    const alongX = Math.sin(vessel.yaw), alongZ = Math.cos(vessel.yaw);
    for (let reach = radius; reach <= SHIP_TRACK_REACH; reach += radius) {
      changed = stamp(vessel.x + alongX * reach, vessel.z + alongZ * reach, radius) || changed;
      changed = stamp(vessel.x - alongX * reach, vessel.z - alongZ * reach, radius) || changed;
    }
    return changed;
  };

  const stampVessel = (key: string, vessel: Vessel, radius: number) => {
    const last = vesselStamps.get(key);
    if (last && Math.hypot(last.x - vessel.x, last.z - vessel.z) < RESTAMP_DISTANCE) return false;
    vesselStamps.set(key, { x: vessel.x, z: vessel.z });
    return stampTrack(vessel, radius);
  };

  const stampFishingSpots = (workers: readonly WorkerFrame[]) => {
    let changed = false;
    for (const worker of workers) {
      const target = worker.fishingTarget;
      if (!target) continue;
      const cell = Math.floor(target.z) * width + Math.floor(target.x);
      if (fishingSpots.has(cell)) continue;
      fishingSpots.add(cell);
      changed = stamp(target.x, target.z, ICE_OPENING_RADII.fishingSpot) || changed;
    }
    return changed;
  };

  const update = (frame: IceFloeOpeningsFrame) => {
    let changed = stampBuildings(frame.buildings ?? []);
    for (const ship of frame.ships ?? []) {
      if (ship.phase === "away") continue;
      changed = stampVessel(`ship:${ship.id}`, ship, ICE_OPENING_RADII.ship) || changed;
    }
    for (const boat of frame.shuttleBoats ?? [])
      changed = stampVessel(`shuttle:${boat.id}`, boat, ICE_OPENING_RADII.boat) || changed;
    for (const boat of frame.fishingBoats ?? []) {
      if (boat.bed === undefined) continue;
      changed = stampVessel(`skiff:${boat.id}`, { x: boat.x, z: boat.z }, ICE_OPENING_RADII.boat) || changed;
    }
    return stampFishingSpots(frame.workers ?? []) || changed;
  };

  return { height, pixels, update, width };
};
