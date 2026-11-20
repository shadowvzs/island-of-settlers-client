import { getBuildingDefinition } from "../../render-common/buildings/building-catalog";

type Point = { x: number; z: number };

/** Quarter turns 0..3 of any integer-ish rotation (negative and > 3 wrap). */
export const normalizeTurns = (rotation: number) => ((Math.round(rotation) % 4) + 4) % 4;

/** The plot size in cells after `rotation` quarter turns (odd turns swap width and depth). */
export const rotatedFootprint = (id: number, rotation: number) => {
  const [baseWidth, baseDepth] = getBuildingDefinition(id).gridFootprint;
  const turns = normalizeTurns(rotation);
  return turns % 2
    ? { depth: baseWidth, turns, width: baseDepth }
    : { depth: baseDepth, turns, width: baseWidth };
};

/** Integer plot corners stay on the simulation grid when a 2×3 footprint becomes 3×2. */
export const snapBuildingPlot = (id: number, point: Point, rotation: number) => {
  const { depth, turns, width } = rotatedFootprint(id, rotation);
  return {
    depth,
    rotation: turns,
    width,
    x: Math.round(point.x - width / 2) + width / 2,
    z: Math.round(point.z - depth / 2) + depth / 2
  };
};
