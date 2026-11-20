import { BUILDING_MENU } from "../../render-common/buildings/building-menu";
import type { WorldData } from "../world/world-data";
import { MATERIAL_BUILDING_GROUPS } from "./advanced-material-production";

/** Only the current island's usable occupations; legacy compatibility models are not build obligations. */
export const scenarioSpaceStages = (world: WorldData) => {
  const material = MATERIAL_BUILDING_GROUPS.find(group => group.tier === world.colonyResourceTier);
  const stages = [
    { name: "Construction supply", mandatory: true, required: [material?.woodcutter ?? 17, 33, material?.quarry ?? 19, material?.forester ?? 20] },
    { name: "Renewable food", mandatory: true, required: [35, 37, 31, 32, 18] },
    { name: "Tools and recruitment", mandatory: false, required: [27, 12, 26, 25, 24, 40, 1] }
  ];
  const assigned = new Set([0, 39, ...stages.flatMap(stage => stage.required)]);
  const materialIds = new Set<number>(MATERIAL_BUILDING_GROUPS.flatMap(group => [group.forester, group.woodcutter, group.quarry]));
  const selected = new Set<number>(material ? [material.forester, material.woodcutter, material.quarry] : []);
  const remaining = BUILDING_MENU.flatMap(group => group.buildings).filter(definition =>
    !assigned.has(definition.id) && (!materialIds.has(definition.id) || selected.has(definition.id)));
  stages.push({ name: "Optional remaining economy and military plots", mandatory: false, required: remaining.map(definition => definition.id) });
  return stages;
};

/** Bounded ring enumeration avoids allocating/sorting an entry for every cell of a 512² map. */
export const scenarioSpaceCandidates = (world: Pick<WorldData, "cellsX" | "cellsZ">,
  home: { x: number; z: number }, owned: Uint8Array, limit = 8192) => {
  const points: Array<{ x: number; z: number }> = [];
  const cx = Math.floor(home.x), cz = Math.floor(home.z);
  const add = (x: number, z: number) => {
    if (points.length < limit && x >= 0 && z >= 0 && x < world.cellsX && z < world.cellsZ && owned[z * world.cellsX + x] === 1)
      points.push({ x, z });
  };
  for (let radius = 0; radius <= Math.max(world.cellsX, world.cellsZ) && points.length < limit; radius++) {
    if (!radius) { add(cx, cz); continue; }
    for (let dx = -radius; dx <= radius; dx++) { add(cx + dx, cz - radius); add(cx + dx, cz + radius); }
    for (let dz = -radius + 1; dz < radius; dz++) { add(cx - radius, cz + dz); add(cx + radius, cz + dz); }
  }
  return points;
};
