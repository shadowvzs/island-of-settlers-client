import { THEME_COUNT } from "../generation/island-themes";
import { EMPTY_REGION } from "../grid-geometry";
import type { WorldData } from "../world-data";
import { type Brush,getBrushWeight, getVertexRangeCells } from "./brush";

/** Changes biome weights only; manual materials, terrain, ore and placed props survive. */
export const paintBiome = (world: WorldData, brush: Brush, theme: number, strength: number) => {
  if (!Number.isInteger(theme) || theme < 0 || theme >= THEME_COUNT || !Number.isFinite(strength))
    return EMPTY_REGION;
  const influence = Math.max(0, Math.min(1, strength));
  if (!influence) return EMPTY_REGION;
  const range = {
    maxX: Math.min(world.cellsX, Math.floor(brush.x + brush.radius)),
    maxZ: Math.min(world.cellsZ, Math.floor(brush.z + brush.radius)),
    minX: Math.max(0, Math.ceil(brush.x - brush.radius)),
    minZ: Math.max(0, Math.ceil(brush.z - brush.radius))
  };
  let changed = false;
  for (let z = range.minZ; z <= range.maxZ; z++) {
    for (let x = range.minX; x <= range.maxX; x++) {
      const cover = getBrushWeight(brush, Math.hypot(x - brush.x, z - brush.z)) * influence;
      if (cover <= 0) continue;
      const offset = (z * (world.cellsX + 1) + x) * THEME_COUNT;
      let rest = 0;
      for (let kind = 0; kind < THEME_COUNT; kind++) {
        if (kind === theme) continue;
        const previous = world.themeWeights[offset + kind]!;
        const next = Math.round(previous * (1 - cover));
        changed ||= next !== previous;
        world.themeWeights[offset + kind] = next;
        rest += next;
      }
      const selected = 255 - rest;
      changed ||= world.themeWeights[offset + theme] !== selected;
      world.themeWeights[offset + theme] = selected;
    }
  }
  if (!changed) return EMPTY_REGION;
  world.buildRevision = (world.buildRevision ?? 0) + 1;
  return getVertexRangeCells(world, range);
};
