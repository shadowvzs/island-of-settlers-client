import { DMath } from "../../shared/math/deterministic-math";
import { resolveWareId } from "../wares/ware-catalog";
import { createWareRecipe } from "../wares/ware-recipe";
import { WATER_WARE_SCALE } from "../wares/water-bucket-dimensions";
import { WORKER_SCALE } from "../workers/worker-dimensions";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { packBuildingStockBays } from "./stock-bay-packing";
import { seatTanneryTableStock } from "./tannery-table-contact";

export interface RomanWareStockSlot {
  stock: NonNullable<BuildingPart["stock"]>;
  parts: BuildingPart[];
  center: Point3;
  bottom: number;
  support?: RomanWareStockSlot;
  yaw: number;
  horizontalSpan: readonly [number, number];
}

export const isCanonicalRomanWareStock = (stock: BuildingPart["stock"]) =>
  Boolean(stock && stock.presentation !== "hanging" && resolveWareId(stock.ware));

const slotCache = new WeakMap<BuildingRecipe, RomanWareStockSlot[]>();
/** Authored supports and slot positions remain fixed when their contents become carried wares. */
const rawStockSlots = (recipe: BuildingRecipe): RomanWareStockSlot[] => {
  const cached = slotCache.get(recipe);
  if (cached) return cached;
  const grouped = new Map<string, BuildingPart[]>();
  for (const part of recipe.parts) {
    if (!part.stock) continue;
    const key = `${part.stock.kind ?? "output"}:${part.stock.ware}:${part.stock.slot}`;
    const pieces = grouped.get(key) ?? []; pieces.push(part); grouped.set(key, pieces);
  }
  const slots = [...grouped.values()].map(parts => {
    const bounds = parts.map(part => getRomanPartBounds(part));
    const minimum = [0, 1, 2].map(axis => Math.min(...bounds.map(bound => bound.min[axis]!)));
    const maximum = [0, 1, 2].map(axis => Math.max(...bounds.map(bound => bound.max[axis]!)));
    const largest = parts.reduce((best, part) => part.size.reduce((a, b) => a * b, 1) >
      best.size.reduce((a, b) => a * b, 1) ? part : best);
    return { stock: parts[0]!.stock!, parts,
      center: minimum.map((value, axis) => (value + maximum[axis]!) / 2) as Point3,
      bottom: minimum[1]!, yaw: largest.rotation?.[1] ?? 0,
      horizontalSpan: [maximum[0]! - minimum[0]!, maximum[2]! - minimum[2]!] as const };
  });
  // Compact cargo and the fish tray retain their authored stock columns.
  // Derive upper-row support from the actual displayed cargo instead of leaving gaps between units.
  for (const slot of slots as RomanWareStockSlot[]) {
    if (!["hardwoodLogs", "iron", "fish"].includes(slot.stock.ware)) continue;
    slot.support = slots.filter(candidate => candidate.stock.ware === slot.stock.ware &&
      candidate.stock.kind === slot.stock.kind && candidate.bottom < slot.bottom - .001 &&
      Math.abs(candidate.center[0] - slot.center[0]) < .001 &&
      Math.abs(candidate.center[2] - slot.center[2]) < .001)
      .sort((a, b) => b.bottom - a.bottom)[0];
  }
  slotCache.set(recipe, slots);
  return slots;
};

const packedSlotCache = new WeakMap<BuildingRecipe, Map<number, RomanWareStockSlot[]>>();
export const getRomanWareStockSlots = (recipe: BuildingRecipe, scale?: number): RomanWareStockSlot[] => {
  const raw = rawStockSlots(recipe);
  if (scale === undefined) return raw;
  const cached = packedSlotCache.get(recipe)?.get(scale);
  if (cached) return cached;
  const packed = seatTanneryTableStock(recipe, scale, packBuildingStockBays(recipe, raw, scale));
  const entries = packedSlotCache.get(recipe) ?? new Map();
  entries.set(scale, packed); packedSlotCache.set(recipe, entries);
  return packed;
};

/** The simulation's transfer target is the same canonical model transform used by the renderer. */
/** What seating reads of a slot (also satisfied by the stored navigation slot placements). */
export interface RomanWareStockPlacementSlot {
  bottom: number;
  center: readonly [number, number, number];
  horizontalSpan: readonly [number, number];
  support?: RomanWareStockPlacementSlot;
  yaw: number;
}
export const romanWareStockPlacement = (slot: RomanWareStockPlacementSlot, ware: string, scale: number): {
  ratio: number; dimensions: Point3; yaw: number; center: Point3; position: Point3;
} => {
  const parts = createWareRecipe(ware, true).parts;
  const bounds = parts.map(part => getRomanPartBounds(part));
  const minimum = [0, 1, 2].map(axis => Math.min(...bounds.map(bound => bound.min[axis]!)));
  const maximum = [0, 1, 2].map(axis => Math.max(...bounds.map(bound => bound.max[axis]!)));
  const largest = parts.reduce((best, part) => part.size.reduce((a, b) => a * b, 1) >
    best.size.reduce((a, b) => a * b, 1) ? part : best);
  let yaw = slot.yaw - (largest.rotation?.[1] ?? 0);
  const canonicalX = maximum[0]! - minimum[0]!, canonicalZ = maximum[2]! - minimum[2]!;
  const orientedX = Math.abs(canonicalX * DMath.cos(yaw)) + Math.abs(canonicalZ * DMath.sin(yaw));
  const orientedZ = Math.abs(canonicalX * DMath.sin(yaw)) + Math.abs(canonicalZ * DMath.cos(yaw));
  // Authored horizontal logs rotate around Z, not Y; preserve their real bay orientation too.
  const directional = Math.abs(slot.horizontalSpan[0] - slot.horizontalSpan[1]) >
    Math.max(slot.horizontalSpan[0], slot.horizontalSpan[1]) * .1;
  if (ware !== "water" && directional && (slot.horizontalSpan[0] > slot.horizontalSpan[1]) !==
    (orientedX > orientedZ)) yaw += Math.PI / 2;
  const ratio = WORKER_SCALE / scale, cosine = DMath.cos(yaw), sine = DMath.sin(yaw);
  const dimensions: Point3 = ware === "water"
    ? [WATER_WARE_SCALE.x / scale, WATER_WARE_SCALE.y / scale, WATER_WARE_SCALE.z / scale]
    : [ratio, ratio, ratio];
  const centerX = (minimum[0]! + maximum[0]!) * dimensions[0] / 2;
  const centerZ = (minimum[2]! + maximum[2]!) * dimensions[2] / 2;
  const height = (maximum[1]! - minimum[1]!) * dimensions[1];
  const support = slot.support ? romanWareStockPlacement(slot.support, ware, scale) : undefined;
  const bottom = support ? support.center[1] + height / 2 : slot.bottom;
  return { ratio, dimensions, yaw,
    center: [slot.center[0], bottom + (maximum[1]! - minimum[1]!) * dimensions[1] / 2,
      slot.center[2]] as Point3,
    position: [slot.center[0] - centerX * cosine - centerZ * sine,
    bottom - minimum[1]! * dimensions[1], slot.center[2] + centerX * sine - centerZ * cosine] as Point3 };
};

/** The ware model's parts seated at a canonical slot (shared by the renderer and the navigation sidecars). */
export const seatRomanWareStockParts = (
  slot: RomanWareStockPlacementSlot & Pick<RomanWareStockSlot, "stock">,
  ware: string, scale: number, detailed: boolean
): BuildingPart[] => {
  const { dimensions, position, yaw } = romanWareStockPlacement(slot, ware, scale);
  const cosine = DMath.cos(yaw), sine = DMath.sin(yaw);
  return createWareRecipe(ware, detailed).parts.map(piece => {
    const [x, y, z] = piece.position;
    return { ...piece, stock: { ...slot.stock, ware },
      position: [position[0] + x * dimensions[0] * cosine + z * dimensions[2] * sine, position[1] + y * dimensions[1],
        position[2] - x * dimensions[0] * sine + z * dimensions[2] * cosine] as Point3,
      size: piece.size.map((value, axis) => value * dimensions[axis]!) as Point3,
      rotation: [piece.rotation?.[0] ?? 0, (piece.rotation?.[1] ?? 0) + yaw, piece.rotation?.[2] ?? 0] as Point3 };
  });
};

const presentationCache = new WeakMap<BuildingRecipe, Map<string, BuildingPart[]>>();
export const getRomanWareStockPresentationParts = (
  recipe: BuildingRecipe, scale: number, detailed: boolean, requestedWare?: string
): BuildingPart[] => {
  const key = `${scale}:${detailed}:${requestedWare ?? ""}`;
  const cached = presentationCache.get(recipe)?.get(key);
  if (cached) return cached;
  const slots = getRomanWareStockSlots(recipe, scale);
  const result = recipe.parts.filter(part => !isCanonicalRomanWareStock(part.stock));
  for (const slot of slots) {
    if (!isCanonicalRomanWareStock(slot.stock)) continue;
    const ware = requestedWare && slot.stock.wares?.includes(requestedWare) ? requestedWare : slot.stock.ware;
    result.push(...seatRomanWareStockParts(slot, ware, scale, detailed));
  }
  const entries = presentationCache.get(recipe) ?? new Map(); entries.set(key, result); presentationCache.set(recipe, entries);
  return result;
};

/** Inventory follows the same mixed-ware slot order as the actual renderer. */
export const getRomanWareStockInventoryParts = (
  recipe: BuildingRecipe, scale: number, input?: Readonly<Record<string, number>>, output?: Readonly<Record<string, number>>
) => {
  if (!input && !output) return getRomanWareStockPresentationParts(recipe, scale, true);
  const result = recipe.parts.filter(part => {
    if (isCanonicalRomanWareStock(part.stock)) return false;
    if (!part.stock) return true;
    const inventory = part.stock.kind === "input" ? input : output;
    return !inventory || part.stock.slot < (inventory[part.stock.ware] ?? 0);
  });
  for (const slot of getRomanWareStockSlots(recipe, scale)) {
    if (!isCanonicalRomanWareStock(slot.stock)) continue;
    const inventory = slot.stock.kind === "input" ? input : output;
    let ware: string | undefined = slot.stock.ware;
    if (inventory) {
      ware = undefined;
      let index = slot.stock.slot;
      for (const candidate of slot.stock.wares ?? [slot.stock.ware]) {
        const count = Math.max(0, inventory[candidate] ?? 0);
        if (index < count) { ware = candidate; break; }
        index -= count;
      }
    }
    if (!ware) continue;
    result.push(...getRomanWareStockPresentationParts(recipe, scale, true, ware).filter(part =>
      part.stock && (part.stock.kind ?? "output") === (slot.stock.kind ?? "output") &&
      part.stock.slot === slot.stock.slot && (part.stock.ware === ware || part.stock.wares?.includes(ware))));
  }
  return result;
};
