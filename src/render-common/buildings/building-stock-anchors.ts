import { DMath } from "../../shared/math/deterministic-math";
import { createWareRecipe } from "../wares/ware-recipe";
import { isBuildingCourtyardPointConnected } from "./building-courtyard";
import type { Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { type BuildingStockStyle, getBuildingStockLayout } from "./building-stock-layout";
import { getRomanWareStockPresentationParts, getRomanWareStockSlots, romanWareStockPlacement } from "./roman-ware-stock";
import { tanneryTableApproach } from "./tannery-table-contact";

export interface BuildingStockContact {
  presentation?: "hanging";
  ware: string;
  slot: number;
  /** Ware centre at the actual visible authored stock, including fitted scale. */
  stock: Point3;
  /** Standing point just outside the exposed stock edge, inside the owned work yard if needed. */
  approach: Point3;
  /** World yaw toward the ware, for a continuous put-down/pick-up animation. */
  yaw: number;
  /** Authored stock form uses this scale relative to a unit ware recipe. */
  scale: number;
  warePosition: Point3;
  wareScale: Point3;
  wareYaw: number;
}

/** Parts are explicitly tagged: permanent benches, shelves and racks never count as inventory. */
export const getBuildingStockContact = (
  typeId: number, kind: "input" | "output", ware: string, slot: number,
  x: number, z: number, quarterTurns: number, y = 0, inventory?: Record<string, number>,
  otherInventory?: Record<string, number>, style?: BuildingStockStyle,
  /** World-aware callers reject a stance the simulation cannot physically reach. */
  isWalkable?: (point: { x: number; z: number }) => boolean
): BuildingStockContact | null => {
  const { recipe, scale } = getBuildingStockLayout(typeId, style);
  const candidates = getRomanWareStockPresentationParts(recipe, scale, true, ware).filter(part => part.stock && (part.stock.kind ?? "output") === kind &&
    (part.stock.ware === ware || part.stock.wares?.includes(ware)));
  // In-flight production may exceed the soft shelf threshold. Use its existing exposed
  // last handoff position; never invent a new contact in the road or block a finished batch.
  const lastSlot = Math.max(...candidates.map(part => part.stock!.slot));
  let selectedSlot = Math.min(slot, lastSlot);
  const aliases = candidates.find(part => part.stock?.wares?.includes(ware))?.stock?.wares;
  if (inventory && aliases && kind === "input") {
    const before = aliases.slice(0, aliases.indexOf(ware)).reduce((sum, item) =>
      sum + Math.max(0, inventory[item] ?? 0), 0);
    selectedSlot = Math.min(lastSlot, before + slot);
  }
  if (inventory && aliases && kind === "output") {
    const total = aliases.reduce((sum, item) => sum + Math.max(0, inventory[item] ?? 0), 0);
    const before = aliases.slice(0, aliases.indexOf(ware)).reduce((sum, item) => sum + Math.max(0, inventory[item] ?? 0), 0);
    selectedSlot = Math.min(Math.max(...candidates.map(part => part.stock!.slot)), before + Math.max(0, (inventory[ware] ?? 0) - (slot < total ? 1 : 0)));
  }
  const parts = candidates.filter(part => part.stock!.slot === selectedSlot);
  if (!parts.length) return null;
  const minimum: Point3 = [Infinity, Infinity, Infinity], maximum: Point3 = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const bounds = getRomanPartBounds(part);
    for (let axis = 0; axis < 3; axis++) {
      minimum[axis] = Math.min(minimum[axis]!, bounds.min[axis]!);
      maximum[axis] = Math.max(maximum[axis]!, bounds.max[axis]!);
    }
  }
  const local: Point3 = minimum.map((value, axis) => (value + maximum[axis]!) * scale / 2) as Point3;
  const approach: Point3 = [local[0], 0, local[2]];
  const halfX = (maximum[0] - minimum[0]) * scale / 2;
  const halfZ = (maximum[2] - minimum[2]) * scale / 2;
  // Prefer an outward-facing edge with the shortest reach to this actual slot.
  // The reserved rectangle also includes roofs and smoke, and cannot define a hand-off position.
  const xScore = Math.abs(local[0]) / Math.max(.001, halfX + .225);
  const zScore = Math.abs(local[2]) / Math.max(.001, halfZ + .225);
  if (xScore >= zScore) approach[0] += (local[0] < 0 ? -1 : 1) * (halfX + .225);
  else approach[2] += (local[2] < 0 ? -1 : 1) * (halfZ + .225);
  // The exposed front tray edge stays connected to the yard and keeps every slot within reach.
  if (typeId === 18 && kind === "output" && ware === "fish") {
    const trayEdge = Math.max(...candidates.map(part => getRomanPartBounds(part).max[2])) * scale;
    approach[0] = local[0];
    approach[2] = trayEdge + .215;
  }
  // Each farm harvest-bay row has its own exposed edge; its narrow side pockets are isolated.
  if (typeId === 37 && kind === "output" && ware === "grain") {
    approach[0] = local[0];
    approach[2] = local[2] + halfZ + .225;
  }
  // The flax drying rack and cloth shelf are worked from their open front, not from the plot edge.
  if (typeId === 60 && kind === "output" && ware === "flax") {
    approach[0] = local[0];
    approach[2] = local[2] + halfZ + .225;
  }
  if (typeId === 61 && (ware === "cloth" || kind === "input" && ware === "flax")) {
    approach[0] = local[0];
    approach[2] = local[2] + halfZ + .225;
  }
  // Water carriers collect from the front. The left flank belongs to the windlass operator.
  if (typeId === 35 && kind === "output" && ware === "water") {
    approach[0] = local[0];
    // Output is collected from the exposed last slot: stay close enough to grasp its handle.
    approach[2] = Math.max(.95, local[2] + halfZ + .225);
  }
  if (typeId === 8 && kind === "output" && ware === "leather") {
    const table = tanneryTableApproach(recipe, scale, local);
    if (table) approach.splice(0, 3, ...table);
  }
  const angle = (((quarterTurns % 4) + 4) % 4) * Math.PI / 2;
  const cosine = Math.round(DMath.cos(angle)), sine = Math.round(DMath.sin(angle));
  const transform = (point: Point3): Point3 => [x + point[0] * cosine + point[2] * sine,
    y + point[1], z - point[0] * sine + point[2] * cosine];
  const worldStock = transform(local);
  let worldApproach = transform(approach);
  let occupied = inventory;
  if (inventory) {
    const count = aliases && kind === "output" ? aliases.reduce((sum, item) => sum + (inventory[item] ?? 0), 0)
      : inventory[ware] ?? 0;
    if (slot >= count) occupied = { ...inventory, [ware]: (inventory[ware] ?? 0) + 1 };
  }
  // Validate the lane with the incoming unit already present; the empty carrier must still be able to leave.
  const output = kind === "output" ? occupied ?? (typeId === 37 && ware === "grain" ? { grain: selectedSlot + 1 } : undefined) : otherInventory;
  const input = kind === "input" ? occupied : otherInventory;
  const reachable = (point: { x: number; z: number }) =>
    isBuildingCourtyardPointConnected(typeId, x, z, quarterTurns, point, output, input, style) &&
    (!isWalkable || isWalkable(point));
  if (!reachable({ x: worldApproach[0], z: worldApproach[2] })) {
    const preferred = DMath.atan2(worldApproach[0] - worldStock[0], worldApproach[2] - worldStock[2]);
    search: for (let radius = .35; radius <= 1.55; radius += .1) {
      for (let sample = 0; sample < 24; sample++) {
        const direction = preferred + (sample % 2 ? -1 : 1) * Math.ceil(sample / 2) * Math.PI / 12;
        const point = { x: worldStock[0] + DMath.sin(direction) * radius, z: worldStock[2] + DMath.cos(direction) * radius };
        if (!reachable(point)) continue;
        worldApproach = [point.x, y, point.z];
        break search;
      }
    }
  }
  if ([20, 41].includes(typeId) && ware === "seedling") {
    const sapling = parts.find(part => part.shape === "nursery-sapling")!;
    const grip = transform([sapling.position[0] * scale,
      (sapling.position[1] - sapling.size[1] * .25) * scale, sapling.position[2] * scale]);
    return { ware, slot: selectedSlot, stock: worldStock, approach: worldApproach,
      warePosition: grip, wareScale: [scale, scale, scale], wareYaw: angle,
      yaw: DMath.atan2(worldStock[0] - worldApproach[0], worldStock[2] - worldApproach[2]), scale };
  }
  const canonicalSlot = getRomanWareStockSlots(recipe, scale).find(candidate =>
    (candidate.stock.kind ?? "output") === kind && candidate.stock.slot === selectedSlot &&
    (candidate.stock.ware === ware || candidate.stock.wares?.includes(ware)));
  if (canonicalSlot && canonicalSlot.stock.presentation !== "hanging") {
    const placement = romanWareStockPlacement(canonicalSlot, ware, scale);
    const warePosition = transform(placement.position.map(value => value * scale) as Point3);
    const stock = transform(placement.center.map(value => value * scale) as Point3);
    const wareScale = placement.dimensions.map(value => value * scale) as Point3;
    return { ware, slot: selectedSlot, stock, approach: worldApproach,
      warePosition, wareScale, wareYaw: angle + placement.yaw,
      yaw: DMath.atan2(stock[0] - worldApproach[0], stock[2] - worldApproach[2]), scale };
  }
  const wholeHide = parts.find(part => part.shape === "stretched-hide" && part.stock?.presentation === "hanging");
  if (wholeHide && ware === "hides") {
    const center = transform(wholeHide.position.map(value => value * scale) as Point3);
    return { ware, slot: selectedSlot, stock: center, approach: worldApproach, presentation: "hanging",
      warePosition: center, wareScale: [scale, scale, scale], wareYaw: angle + (wholeHide.rotation?.[1] ?? 0),
      yaw: DMath.atan2(center[0] - worldApproach[0], center[2] - worldApproach[2]), scale };
  }
  const canonicalParts = createWareRecipe(ware, true).parts;
  const largest = (pieces: typeof parts) => pieces.reduce((best, piece) =>
    piece.size.reduce((product, value) => product * value, 1) >
    best.size.reduce((product, value) => product * value, 1) ? piece : best);
  const localYaw = (largest(parts).rotation?.[1] ?? 0) - (largest(canonicalParts).rotation?.[1] ?? 0);
  const oriented = parts.map(part => getRomanPartBounds(part, -localYaw));
  const targetMin = [0, 1, 2].map(axis => Math.min(...oriented.map(bounds => bounds.min[axis]!)));
  const targetMax = [0, 1, 2].map(axis => Math.max(...oriented.map(bounds => bounds.max[axis]!)));
  const canonical = canonicalParts.map(part => getRomanPartBounds(part));
  const canonicalMin = [0, 1, 2].map(axis => Math.min(...canonical.map(bounds => bounds.min[axis]!)));
  const canonicalMax = [0, 1, 2].map(axis => Math.max(...canonical.map(bounds => bounds.max[axis]!)));
  const wareScale = targetMax.map((value, axis) => (value - targetMin[axis]!) * scale /
    Math.max(.001, canonicalMax[axis]! - canonicalMin[axis]!)) as Point3;
  const offset = canonicalMin.map((value, axis) => (value + canonicalMax[axis]!) * wareScale[axis]! / 2) as Point3;
  const wareYaw = angle + localYaw, wareCosine = DMath.cos(wareYaw), wareSine = DMath.sin(wareYaw);
  const warePosition: Point3 = [worldStock[0] - offset[0] * wareCosine - offset[2] * wareSine,
    worldStock[1] - offset[1], worldStock[2] + offset[0] * wareSine - offset[2] * wareCosine];
  return { ware, slot: selectedSlot, stock: worldStock, approach: worldApproach, warePosition, wareScale, wareYaw,
    yaw: DMath.atan2(worldStock[0] - worldApproach[0], worldStock[2] - worldApproach[2]), scale };
};
