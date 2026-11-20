import type { WorldData } from "../../shared/world/world-data";
import { deckLookoutSlot } from "./ship-deck-people";
import type { ShipFrame } from "./ship-frame";
import { shipDeckWorldPose } from "./ship-motion";
import { deckHorseYaw, deckPassengerYaw, troopDeckLayout } from "./troop-deck-horse";

/** World pose of one passenger standing on a drawn ship. */
export interface DeckPassengerPose {
  /** The ship is observing a coast: the scout raises the spyglass toward the island. */
  observing: boolean;
  /** Direction to the observed coast (the hull's heading when not observing). */
  observingYaw: number;
  /** Seconds into the pause, so the spyglass scan starts again at each stop. */
  observationSeconds: number;
  x: number;
  y: number;
  yaw: number;
  z: number;
}

const LOOKOUT_SEARCH = 32;
const observationYawCache = new WeakMap<object, Map<string, number>>();

const isLand = (world: Pick<WorldData, "cellsX" | "cellsZ" | "heights" | "seaLevel">, x: number, z: number) =>
  x >= 0 && z >= 0 && x < world.cellsX && z < world.cellsZ &&
  world.heights[z * (world.cellsX + 1) + x]! > world.seaLevel;

/** Bearing from a ship to the nearest land cell, or its heading when no coast lies within reach. */
export const nearestLandYaw = (
  world: Pick<WorldData, "cellsX" | "cellsZ" | "heights" | "seaLevel">,
  x: number, z: number, fallback: number
) => {
  let cache = observationYawCache.get(world);
  if (!cache) { cache = new Map(); observationYawCache.set(world, cache); }
  const key = `${Math.round(x)}:${Math.round(z)}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const centreX = Math.floor(x), centreZ = Math.floor(z);
  for (let radius = 1; radius <= LOOKOUT_SEARCH; radius++) {
    let nearest: { distance: number; x: number; z: number } | undefined;
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
      const cellX = centreX + dx, cellZ = centreZ + dz;
      if (!isLand(world, cellX, cellZ)) continue;
      const distance = Math.hypot(cellX + .5 - x, cellZ + .5 - z);
      if (!nearest || distance < nearest.distance) nearest = { distance, x: cellX, z: cellZ };
    }
    if (nearest) {
      const yaw = Math.atan2(nearest.x + .5 - x, nearest.z + .5 - z);
      if (cache.size > 64) cache.delete(cache.keys().next().value!);
      cache.set(key, yaw);
      return yaw;
    }
  }
  return fallback;
};

/** Where each simulation passenger stands on the hull as it is drawn this frame, keyed by actor uid. */
export const deckPassengerPoses = (
  ships: readonly ShipFrame[],
  world: Pick<WorldData, "cellsX" | "cellsZ" | "heights" | "seaLevel">,
  time: number
) => {
  const poses = new Map<number, DeckPassengerPose>();
  for (const ship of ships) {
    const ids = ship.passengers ?? [];
    if (!ids.length) continue;
    // A troop ship carrying the commander's horse: he stands at its head, the others round it.
    const layout = troopDeckLayout(ship.deckPassengers ?? ids.length, ship.deckHorse?.rider ?? -1);
    const { places } = layout;
    const observing = ship.observing === true;
    const observingYaw = observing ? nearestLandYaw(world, ship.x, ship.z, ship.yaw) : ship.yaw;
    const observationSeconds = ship.observationSeconds ?? 0;
    // The sole exploration scout keeps the clear bow lookout for the whole voyage.
    const lookout = ship.exploration !== undefined && ids.length === 1;
    ids.forEach((uid, index) => {
      const place = lookout ? deckLookoutSlot() : places[index];
      if (!place) return;
      const pose = shipDeckWorldPose(ship, place, time);
      const yaw = pose.yaw + deckPassengerYaw(layout, index, index === ship.deckHorse?.rider);
      poses.set(uid, { ...pose, observing, observationSeconds, observingYaw, yaw });
    });
  }
  return poses;
};

/** The commander's horse standing on a drawn troop ship's deck, keyed by its actor uid (it follows the hull). */
export const deckHorsePoses = (ships: readonly ShipFrame[], time: number) => {
  const poses = new Map<number, { x: number; y: number; yaw: number; z: number }>();
  for (const ship of ships) {
    const horse = ship.deckHorse && troopDeckLayout(ship.deckPassengers ?? 0, ship.deckHorse.rider).horse;
    if (!horse) continue;
    const pose = shipDeckWorldPose(ship, horse.slot, time);
    poses.set(ship.deckHorse!.horse, { ...pose, yaw: pose.yaw + deckHorseYaw(horse) });
  }
  return poses;
};
