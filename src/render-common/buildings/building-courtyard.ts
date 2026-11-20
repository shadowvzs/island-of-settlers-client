import { DMath } from "../../shared/math/deterministic-math";
import { WORKER_HEIGHT, WORKER_RADIUS } from "../workers/worker-dimensions";
import { createCourtyardConnectivity } from "./building-courtyard-connectivity";
import { getRomanPartBounds } from "./building-recipe-fit";
import { type BuildingStockStyle, getBuildingStockLayout } from "./building-stock-layout";
import { getRomanWareStockInventoryParts } from "./roman-ware-stock";

interface CourtyardObstacles {
  boxes: { maxX: number; maxZ: number; minX: number; minZ: number }[];
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
}
const obstacles = new Map<string, CourtyardObstacles>();

/** Conservative authored obstruction boxes, not the roof/smoke-sized reserved plot rectangle. */
export const courtyardInventoryKey = (goods?: Readonly<Record<string, number>>) => {
  if (!goods) return "full";
  // Insertion order is stable per stock object; sorting only made the cache key canonical across
  // objects, at the cost of an allocation-heavy sort on every courtyard point query.
  let key = "";
  for (const ware in goods) {
    const count = goods[ware] ?? 0;
    if (count <= 0) continue;
    key += `${ware}:${Math.max(0, Math.min(6, Math.floor(count)))},`;
  }
  return key;
};
const courtyardObstacles = (typeId: number, output?: Readonly<Record<string, number>>, input?: Readonly<Record<string, number>>, style?: BuildingStockStyle) => {
  const key = `${typeId}:${style?.nation ?? "roman"}:${style?.level ?? 1}:` +
    `${courtyardInventoryKey(output)}:${courtyardInventoryKey(input)}`;
  const cached = obstacles.get(key);
  if (cached) return cached;
  const { recipe, scale } = getBuildingStockLayout(typeId, style);
  const boxes = getRomanWareStockInventoryParts(recipe, scale, input, output).filter(part => !["leaf", "rope", "cloth"].includes(part.surface) &&
    // Well stock is an exposed LIFO bay: unused bucket slots must not become permanent obstacles.
    !(typeId === 35 && part.stock))
    .map(part => getRomanPartBounds(part))
    .filter(bound => bound.max[1] * scale > .025 && bound.min[1] * scale < WORKER_HEIGHT + .025)
    .map(bound => ({ minX: bound.min[0] * scale, maxX: bound.max[0] * scale,
      minZ: bound.min[2] * scale, maxZ: bound.max[2] * scale }));
  const entry = boxes.reduce<CourtyardObstacles>((union, box) => ({
    boxes,
    maxX: Math.max(union.maxX, box.maxX),
    maxZ: Math.max(union.maxZ, box.maxZ),
    minX: Math.min(union.minX, box.minX),
    minZ: Math.min(union.minZ, box.minZ)
  }), { boxes, maxX: -Infinity, maxZ: -Infinity, minX: Infinity, minZ: Infinity });
  obstacles.set(key, entry);
  return entry;
};

/** Only authorize this for the worker's active owned stock lane; other plots stay reserved. */
export const isBuildingCourtyardPointWalkable = (
  typeId: number, x: number, z: number, quarterTurns: number, point: { x: number; z: number }, output?: Readonly<Record<string, number>>, input?: Readonly<Record<string, number>>, style?: BuildingStockStyle
) => {
  const angle = quarterTurns * Math.PI / 2, cosine = Math.round(DMath.cos(angle)), sine = Math.round(DMath.sin(angle));
  const dx = point.x - x, dz = point.z - z;
  const localX = dx * cosine - dz * sine, localZ = dx * sine + dz * cosine;
  const { boxes, maxX, maxZ, minX, minZ } = courtyardObstacles(typeId, output, input, style);
  const margin = WORKER_RADIUS + .005;
  if (localX < minX - margin || localX > maxX + margin || localZ < minZ - margin || localZ > maxZ + margin)
    return true;
  return boxes.every(bound => {
    const distanceX = Math.max(bound.minX - localX, 0, localX - bound.maxX);
    const distanceZ = Math.max(bound.minZ - localZ, 0, localZ - bound.maxZ);
    return DMath.hypot(distanceX, distanceZ) >= margin;
  });
};

const connectivity = new Map<string, ReturnType<typeof createCourtyardConnectivity>>();
export const isBuildingCourtyardPointConnected = (
  typeId: number, x: number, z: number, quarterTurns: number, point: { x: number; z: number },
  output?: Readonly<Record<string, number>>, input?: Readonly<Record<string, number>>, style?: BuildingStockStyle
) => {
  const key = `${typeId}:${style?.nation ?? "roman"}:${style?.level ?? 1}:` +
    `${courtyardInventoryKey(output)}:${courtyardInventoryKey(input)}`;
  let check = connectivity.get(key);
  if (!check) {
    const { cells } = getBuildingStockLayout(typeId, style);
    // The cached flood is keyed by this inventory: snapshot it, live building stock mutates later.
    const outputSnapshot = output && { ...output }, inputSnapshot = input && { ...input };
    check = createCourtyardConnectivity(cells[0], cells[1], (localX, localZ) =>
      isBuildingCourtyardPointWalkable(typeId, 0, 0, 0, { x: localX, z: localZ }, outputSnapshot, inputSnapshot, style));
    connectivity.set(key, check);
  }
  const angle = quarterTurns * Math.PI / 2, cosine = Math.round(DMath.cos(angle)), sine = Math.round(DMath.sin(angle));
  const dx = point.x - x, dz = point.z - z;
  return check(dx * cosine - dz * sine, dx * sine + dz * cosine);
};

/** Stock can change around a saved worker. Only steps out of an existing overlap are legal. */
export const isBuildingCourtyardEscapeStep = (
  typeId: number, x: number, z: number, quarterTurns: number,
  from: { x: number; z: number }, to: { x: number; z: number },
  output?: Readonly<Record<string, number>>, input?: Readonly<Record<string, number>>, style?: BuildingStockStyle
) => {
  const angle = quarterTurns * Math.PI / 2;
  const cosine = Math.round(DMath.cos(angle)), sine = Math.round(DMath.sin(angle));
  const local = (point: { x: number; z: number }) => ({
    x: (point.x - x) * cosine - (point.z - z) * sine,
    z: (point.x - x) * sine + (point.z - z) * cosine
  });
  const start = local(from), end = local(to);
  const clearance = WORKER_RADIUS + .005;
  let escaping = false;
  for (const bound of courtyardObstacles(typeId, output, input, style).boxes) {
    // Signed distance also measures progress from the interior of a box.
    const distance = (point: { x: number; z: number }) => {
      const dx = Math.max(bound.minX - point.x, point.x - bound.maxX);
      const dz = Math.max(bound.minZ - point.z, point.z - bound.maxZ);
      return DMath.hypot(Math.max(0, dx), Math.max(0, dz)) + Math.min(0, Math.max(dx, dz));
    };
    const before = distance(start), after = distance(end);
    if (after >= clearance) continue;
    if (before >= clearance || after <= before + 1e-8) return false;
    escaping = true;
  }
  return escaping;
};
