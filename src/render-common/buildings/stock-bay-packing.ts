import type { BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { spaceIndigenousGraniteColumns } from "./indigenous-quarry-bearing";
import type { RomanWareStockSlot } from "./roman-ware-stock";
import { stockWareDimensions } from "./ware-stock-envelope";

const EPSILON = .002;
type Bounds = { min: Point3; max: Point3 };
const overlaps = (a: Bounds, b: Bounds) => [0, 1, 2].every(axis =>
  a.min[axis]! < b.max[axis]! - EPSILON && a.max[axis]! > b.min[axis]! + EPSILON);
const sameBay = (a: RomanWareStockSlot, b: RomanWareStockSlot) =>
  (a.stock.kind ?? "output") === (b.stock.kind ?? "output") &&
  (a.stock.wares ?? [a.stock.ware]).join(",") === (b.stock.wares ?? [b.stock.ware]).join(",");
const eligible = (slot: RomanWareStockSlot) => slot.stock.presentation !== "hanging" &&
  !["pig", "boat", "seedling"].includes(slot.stock.ware) &&
  !slot.parts.some(part => ["catapult-rock", "nursery-sapling", "stretched-hide"].includes(part.shape));

/** A mixed inventory bay reserves the largest actual carried item on each axis. */
const sizeOf = (slot: RomanWareStockSlot, scale: number): Point3 => {
  const sizes = (slot.stock.wares ?? [slot.stock.ware]).map(ware =>
    stockWareDimensions(ware, scale, slot.yaw, slot.horizontalSpan).size);
  return [0, 1, 2].map(axis => Math.max(...sizes.map(size => size[axis]!))) as Point3;
};
const boundsAt = (slot: RomanWareStockSlot, size: Point3): Bounds => ({
  min: [slot.center[0] - size[0] / 2, slot.bottom, slot.center[2] - size[2] / 2],
  max: [slot.center[0] + size[0] / 2, slot.bottom + size[1], slot.center[2] + size[2] / 2]
});
const containsFoot = (support: Bounds, stock: Bounds) => [0, 2].every(axis =>
  Math.min(support.max[axis]!, stock.max[axis]!) - Math.max(support.min[axis]!, stock.min[axis]!) >=
    (stock.max[axis]! - stock.min[axis]!) * .9 - EPSILON);

/** Cold recipe cache only: never called from an actor/frame update. No capacity or inventory changes. */
export const packBuildingStockBays = (recipe: BuildingRecipe, original: readonly RomanWareStockSlot[], scale: number) => {
  const copies: RomanWareStockSlot[] = original.map(slot => ({ ...slot, center: [...slot.center] as Point3,
    support: undefined }));
  // Pig feed bundles lie across their storage strip, rather than end-to-end down the whole yard.
  if (recipe.parts.some(part => part.shape === "pig-residents")) {
    for (const slot of copies) if (slot.stock.kind === "input" && slot.stock.ware === "grain") {
      slot.yaw += Math.PI / 2;
      slot.horizontalSpan = [slot.horizontalSpan[1], slot.horizontalSpan[0]];
    }
  }
  const sizes = new Map(copies.map(slot => [slot, sizeOf(slot, scale)]));
  spaceIndigenousGraniteColumns(recipe, copies, sizes);
  const staticBounds = recipe.parts.filter(part => !part.stock && part.shape !== "indigenous-floor-hide" &&
    !["leaf", "rope", "cloth", "dark"].includes(part.surface)).map(part => getRomanPartBounds(part));
  const originalBounds = original.map((slot, index) => boundsAt(slot, sizes.get(copies[index]!)!));
  const columns = new Map<RomanWareStockSlot, RomanWareStockSlot[]>();
  for (const slot of copies.filter(eligible)) {
    const base = [...columns.keys()].find(candidate => sameBay(candidate, slot) &&
      Math.abs(candidate.center[0] - slot.center[0]) < EPSILON &&
      Math.abs(candidate.center[2] - slot.center[2]) < EPSILON);
    if (base) columns.get(base)!.push(slot);
    else columns.set(slot, [slot]);
  }
  const upperSlots = new Set([...columns.values()].flatMap(column =>
    [...column].sort((a, b) => a.bottom - b.bottom).slice(1)));
  const supported = (index: number, proposed: Bounds) => {
    const before = originalBounds[index]!;
    if (before.min[1] * scale <= .035) return true;
    const supports = staticBounds.filter(bound => Math.abs(bound.max[1] - before.min[1]) < .025 &&
      containsFoot(bound, before));
    return supports.some(bound => containsFoot(bound, proposed));
  };
  const safe = (group: readonly RomanWareStockSlot[]) => group.every(slot => {
    const index = copies.indexOf(slot), bounds = boundsAt(slot, sizes.get(slot)!);
    if (!slot.support && !upperSlots.has(slot) && !supported(index, bounds)) return false;
    // Existing intersections are separate defects; compaction must not add any new obstruction.
    if (staticBounds.some(other => overlaps(bounds, other) && !overlaps(originalBounds[index]!, other))) return false;
    return copies.every(other => other === slot || !overlaps(bounds, boundsAt(other, sizes.get(other)!)));
  });
  // Actual carried-ware heights support each upper unit, instead of legacy proxy thicknesses.
  for (const column of columns.values()) {
    column.sort((a, b) => a.bottom - b.bottom);
    // Timber recipes already measure their real cut-face geometry, including radial tessellation.
    if (["logs", "hardwoodLogs"].includes(column[0]!.stock.ware)) continue;
    const previous = column.map(slot => ({ bottom: slot.bottom, support: slot.support }));
    for (let index = 1; index < column.length; index++) {
      const slot = column[index]!, below = column[index - 1]!;
      slot.bottom = below.bottom + sizes.get(below)![1]; slot.support = below;
    }
    if (!safe(column)) column.forEach((slot, index) => Object.assign(slot, previous[index]));
  }
  for (const axis of [0, 2] as const) {
    const otherAxis = axis === 0 ? 2 : 0;
    const remaining = new Set(columns.keys());
    while (remaining.size) {
      const first = remaining.values().next().value!;
      const row = [...remaining].filter(slot => sameBay(first, slot) &&
        Math.abs(slot.bottom - first.bottom) < EPSILON &&
        Math.abs(slot.center[otherAxis] - first.center[otherAxis]) < .08)
        .sort((a, b) => a.center[axis] - b.center[axis]);
      for (const slot of row) remaining.delete(slot);
      if (row.length < 2) continue;
      // A wide gap denotes separate work bays, not permission to drag stock across the yard.
      if (row.some((slot, index) => index > 0 &&
        (slot.center[axis] - row[index - 1]!.center[axis]) * scale > .9)) continue;
      const gap = .018 / scale;
      const width = row.reduce((sum, slot) => sum + sizes.get(slot)![axis], 0) + gap * (row.length - 1);
      const firstSize = sizes.get(row[0]!)![axis], lastSize = sizes.get(row.at(-1)!)![axis];
      const min = row[0]!.center[axis] - firstSize / 2;
      const max = row.at(-1)!.center[axis] + lastSize / 2;
      if (width >= max - min - .005) continue;
      const members = row.flatMap(slot => columns.get(slot)!);
      const previous = members.map(slot => slot.center[axis]);
      let cursor = (min + max - width) / 2;
      if (min > 0) cursor = min;
      else if (max < 0) cursor = max - width;
      for (const slot of row) {
        const size = sizes.get(slot)![axis];
        const delta = cursor + size / 2 - slot.center[axis];
        for (const member of columns.get(slot)!) member.center[axis] += delta;
        cursor += size + gap;
      }
      if (!safe(members)) members.forEach((slot, index) => { slot.center[axis] = previous[index]!; });
    }
  }
  // Preserve the existing bottom-up support graph at the new horizontal positions.
  for (const [index, slot] of original.entries()) {
    if (slot.support && !copies[index]!.support)
      copies[index]!.support = copies[original.indexOf(slot.support)];
  }
  return copies;
};
