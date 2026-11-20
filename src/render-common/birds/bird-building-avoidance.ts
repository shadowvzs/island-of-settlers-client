import type { WorkerNation } from "../workers/worker-unit";
import { type BirdBuildingBounds, getBirdBuildingBounds } from "./bird-building-bounds";
import { type BirdBuilding, birdBuildingLevel, birdBuildingNation } from "./bird-building-models";
import { wrapAngle } from "./bird-flight";
import { type BirdRoofPerch,createRoofReservations } from "./bird-roof-perches";

const BIN_SIZE = 8;
const AIR_MARGIN = 0.08;
const AXES = [
  ["x", "minX", "maxX"],
  ["y", "minY", "maxY"],
  ["z", "minZ", "maxZ"]
] as const;
export interface BirdPosition {
  x: number;
  y: number;
  z: number;
}

/** Slab intersection includes the entire step, so interpolation cannot cut through a corner. */
const intersects = (
  box: BirdBuildingBounds,
  from: BirdPosition,
  to: BirdPosition,
  radius: number
) => {
  let entry = 0,
    exit = 1;
  for (const [axis, min, max] of AXES) {
    const delta = to[axis] - from[axis],
      low = box[min] - radius,
      high = box[max] + radius;
    if (Math.abs(delta) < 1e-9) {
      if (from[axis] < low || from[axis] > high) return false;
      continue;
    }
    const first = (low - from[axis]) / delta,
      second = (high - from[axis]) / delta;
    entry = Math.max(entry, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (entry > exit) return false;
  }
  return true;
};

/** Spatial bins rebuild only when a building is added, removed, moved, turned or levelled, or the nation changes. */
export const createBirdBuildingAvoidance = () => {
  const bins = new Map<string, BirdBuildingBounds[]>();
  const turnSides = new WeakMap<object, Map<number, number>>();
  let previous: BirdBuilding[] = [],
    query = 0;
  const isChanged = (building: BirdBuilding, old: BirdBuilding | undefined) =>
    !old ||
    building.uid !== old.uid ||
    building.typeId !== old.typeId ||
    building.x !== old.x ||
    building.y !== old.y ||
    building.z !== old.z ||
    building.rotation !== old.rotation ||
    birdBuildingNation(building) !== birdBuildingNation(old) ||
    birdBuildingLevel(building) !== birdBuildingLevel(old) ||
    ((building.construction ?? 1) >= 1) !== ((old.construction ?? 1) >= 1);
  /** `nation` is the settlement's: buildings without their own are drawn in its architecture. */
  const refresh = (buildings: readonly BirdBuilding[], nation: WorkerNation = "roman") => {
    const placed = (building: BirdBuilding) => building.nation ? building : { ...building, nation };
    const changed =
      buildings.length !== previous.length ||
      buildings.some((building, index) => isChanged(placed(building), previous[index]));
    if (!changed) return false;
    // The upgrade record is mutated in place, so the copy keeps only its level.
    previous = buildings.map((building) => ({
      ...placed(building),
      workshopUpgrade: building.workshopUpgrade && { level: building.workshopUpgrade.level }
    }));
    bins.clear();
    for (const building of previous) {
      const box = getBirdBuildingBounds(building);
      for (let x = Math.floor(box.minX / BIN_SIZE); x <= Math.floor(box.maxX / BIN_SIZE); x++)
        for (let z = Math.floor(box.minZ / BIN_SIZE); z <= Math.floor(box.maxZ / BIN_SIZE); z++) {
          const key = `${x}:${z}`,
            bin = bins.get(key) ?? [];
          bin.push(box);
          bins.set(key, bin);
        }
    }
    return true;
  };
  const hit = (
    from: BirdPosition,
    to: BirdPosition,
    radius: number,
    roof?: BirdRoofPerch | null
  ) => {
    query++;
    const padded = radius + AIR_MARGIN;
    const minX = Math.floor((Math.min(from.x, to.x) - padded) / BIN_SIZE);
    const maxX = Math.floor((Math.max(from.x, to.x) + padded) / BIN_SIZE);
    const minZ = Math.floor((Math.min(from.z, to.z) - padded) / BIN_SIZE);
    const maxZ = Math.floor((Math.max(from.z, to.z) + padded) / BIN_SIZE);
    for (let x = minX; x <= maxX; x++)
      for (let z = minZ; z <= maxZ; z++) {
        const bin = bins.get(`${x}:${z}`);
        if (!bin) continue;
        for (const box of bin) {
          if (box.visited === query) continue;
          if (roof && box.uid === roof.uid && from.y >= roof.surfaceY && to.y >= roof.surfaceY)
            continue;
          box.visited = query;
          if (intersects(box, from, to, padded)) return box;
        }
      }
    return undefined;
  };
  const clear = (point: BirdPosition, radius: number, roof?: BirdRoofPerch | null) =>
    !hit(point, point, radius, roof);
  const target = { x: 0, y: 0, z: 0 };
  const heading = (
    point: BirdPosition,
    desired: number,
    speed: number,
    radius: number,
    identity: object = point,
    slot = 0,
    roof?: BirdRoofPerch | null
  ) => {
    if (!bins.size) return desired;
    const distance = Math.max(1.8, speed * 1.4 + radius);
    target.y = point.y;
    const open = (angle: number) => {
      target.x = point.x + Math.cos(angle) * distance;
      target.z = point.z + Math.sin(angle) * distance;
      return !hit(point, target, radius, roof);
    };
    if (open(desired)) return desired;
    let sides = turnSides.get(identity);
    if (!sides) {
      sides = new Map();
      turnSides.set(identity, sides);
    }
    let side = sides.get(slot);
    for (let angle = Math.PI / 12; angle <= Math.PI; angle += Math.PI / 12) {
      if (side !== undefined) {
        if (open(desired + side * angle)) return wrapAngle(desired + side * angle);
        continue;
      }
      if (open(desired + angle)) side = 1;
      else if (open(desired - angle)) side = -1;
      if (side === undefined) continue;
      sides.set(slot, side);
      return wrapAngle(desired + side * angle);
    }
    return wrapAngle(desired + Math.PI);
  };
  const ahead = { x: 0, y: 0, z: 0 },
    origin = { x: 0, y: 0, z: 0 };
  /** Plan above the full architectural crown before reaching it, retaining clearance while overhead. */
  const clearance = (
    point: BirdPosition,
    course: number,
    speed: number,
    radius: number,
    roof?: BirdRoofPerch | null
  ) => {
    if (!bins.size) return -Infinity;
    const distance = Math.max(3.5, speed * 3 + radius);
    origin.x = point.x;
    origin.z = point.z;
    ahead.x = point.x + Math.cos(course) * distance;
    ahead.z = point.z + Math.sin(course) * distance;
    const padding = radius + AIR_MARGIN + 0.35;
    const minX = Math.floor((Math.min(point.x, ahead.x) - padding) / BIN_SIZE);
    const maxX = Math.floor((Math.max(point.x, ahead.x) + padding) / BIN_SIZE);
    const minZ = Math.floor((Math.min(point.z, ahead.z) - padding) / BIN_SIZE);
    const maxZ = Math.floor((Math.max(point.z, ahead.z) + padding) / BIN_SIZE);
    let floor = -Infinity;
    query++;
    for (let x = minX; x <= maxX; x++)
      for (let z = minZ; z <= maxZ; z++) {
        const bin = bins.get(`${x}:${z}`);
        if (!bin) continue;
        for (const box of bin) {
          if (box.visited === query) continue;
          if (roof && box.uid === roof.uid && point.y >= roof.surfaceY) continue;
          box.visited = query;
          origin.y = ahead.y = box.minY;
          if (intersects(box, origin, ahead, padding)) floor = Math.max(floor, box.maxY + padding);
        }
      }
    return floor;
  };
  const move = (
    from: BirdPosition,
    to: BirdPosition,
    radius: number,
    roof?: BirdRoofPerch | null
  ) => {
    if (!hit(from, to, radius, roof)) return;
    // Slide beside the wall while banking, instead of crossing it or snapping through it.
    const z = to.z;
    to.z = from.z;
    if (!hit(from, to, radius, roof)) return;
    to.x = from.x;
    to.z = z;
    if (!hit(from, to, radius, roof)) return;
    to.x = from.x;
    to.z = from.z;
    if (hit(from, to, radius, roof)) to.y = from.y;
  };
  const recover = (point: BirdPosition, radius: number, roof?: BirdRoofPerch | null) => {
    let moved = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const box = hit(point, point, radius, roof);
      if (!box) break;
      const padding = radius + AIR_MARGIN + 0.002;
      const escapes = [
        { axis: "x" as const, value: box.minX - padding },
        { axis: "x" as const, value: box.maxX + padding },
        { axis: "z" as const, value: box.minZ - padding },
        { axis: "z" as const, value: box.maxZ + padding },
        { axis: "y" as const, value: box.maxY + padding }
      ];
      escapes.sort((a, b) => Math.abs(point[a.axis] - a.value) - Math.abs(point[b.axis] - b.value));
      point[escapes[0]!.axis] = escapes[0]!.value;
      moved = true;
    }
    // Adjacent reservations can trap a lateral escape; clearing their roofs always frees the bird.
    for (let attempt = 0; attempt < 8; attempt++) {
      const box = hit(point, point, radius, roof);
      if (!box) break;
      point.y = box.maxY + radius + AIR_MARGIN + 0.002;
      moved = true;
    }
    return moved;
  };
  const roofs = createRoofReservations(() => previous, clear, hit);
  return { ...roofs, clear, clearance, heading, move, recover, refresh };
};
export type BirdBuildingAvoidance = ReturnType<typeof createBirdBuildingAvoidance>;
