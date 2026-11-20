import { Euler, Matrix4, Vector3 } from "three";

import type { BridgeRecipe, BridgeRecipeInput } from "../../src/render-common/bridges/bridge-recipe";
import type { BuildingPart } from "../../src/render-common/buildings/building-recipe";

export interface Box {
  max: [number, number, number];
  min: [number, number, number];
  part: BuildingPart;
}

/** Axis-aligned bounds of a part's box after its Euler rotation (three.js XYZ order). */
export const bounds = (part: BuildingPart): Box => {
  const matrix = new Matrix4().makeRotationFromEuler(new Euler(...(part.rotation ?? [0, 0, 0])));
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
    const corner = new Vector3(sx * part.size[0], sy * part.size[1], sz * part.size[2]).applyMatrix4(matrix);
    corner.add(new Vector3(...part.position));
    for (const [axis, value] of [corner.x, corner.y, corner.z].entries()) {
      min[axis] = Math.min(min[axis]!, value);
      max[axis] = Math.max(max[axis]!, value);
    }
  }
  return { max, min, part };
};

export const overlapXZ = (a: Box, b: Box) =>
  a.min[0] < b.max[0] - 1e-3 && b.min[0] < a.max[0] - 1e-3 && a.min[2] < b.max[2] - 1e-3 && b.min[2] < a.max[2] - 1e-3;

/**
 * A part stands when its foot reaches the ground at any corner or centre of its footprint, or when it
 * rests on (or is embedded in) another part directly below it.
 */
export const floating = (recipe: BridgeRecipe, input: BridgeRecipeInput) => {
  const boxes = recipe.parts.map(({ part }) => {
    if ("kind" in part) throw new Error("Bridge recipes use building parts");
    return bounds(part);
  });
  // Arch voussoirs carry each other; the ring's springing blocks still need the pier or abutment.
  const isVoussoir = (box: Box) => box.part.position[2] === 0 && box.part.surface === "cut-stone" &&
    (box.part.rotation?.[2] ?? 0) !== 0 && Math.abs(Math.abs(box.part.rotation![2]!) - Math.PI / 2) > 0.05;
  const tolerance = 0.03;
  return boxes.filter(box => {
    if (isVoussoir(box)) return false;
    const foot = box.min[1];
    const samples = [[box.min[0], box.min[2]], [box.max[0], box.min[2]], [box.min[0], box.max[2]],
      [box.max[0], box.max[2]], [(box.min[0] + box.max[0]) / 2, (box.min[2] + box.max[2]) / 2]];
    if (samples.some(([x, z]) => foot <= input.terrainAt(x!, z!) + tolerance)) return false;
    return !boxes.some(other => other !== box && other.min[1] < foot - 1e-4 &&
      other.max[1] >= foot - tolerance && overlapXZ(box, other));
  }).map(box => `${box.part.shape}/${box.part.surface} at ${box.part.position.map(value => value.toFixed(2)).join(",")}`);
};

/** Banks at `bank` on both shores, a river bed 0.6 below a water surface at 0 in the middle. */
export const crossing = (tiles: number, bank: number, detailed: boolean, skew = 0): BridgeRecipeInput => {
  const length = tiles * 0.5, base = Math.max(bank, 0.45);
  const shore = (along: number, across: number) => {
    const fromBank = Math.min(along, length - along) + across * skew;
    return fromBank <= 0.4 ? bank : Math.max(-0.6, bank - (fromBank - 0.4) * 2);
  };
  return {
    deckTopAt: along => base + 0.04 * tiles * Math.sin(Math.PI * Math.min(1, Math.max(0, along / length))),
    detailed,
    length,
    terrainAt: shore,
    tiles,
    waterAt: () => 0
  };
};
