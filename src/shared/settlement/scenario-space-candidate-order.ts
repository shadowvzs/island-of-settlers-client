import { getBuildingDefinition } from "../../render-common/buildings/building-catalog";
import type { WorldData } from "../world/world-data";
import { isMineType, requiredMineOre } from "./settlement-placement";

interface Candidate { x: number; z: number }

/** Search hints only: every result still passes the unchanged native footprint, territory and road checks.
 * A nearest-HQ prefix spends bounded attempts on inland fishery sites and empty mine foundations.
 * Rank prerequisite proximity first, then distribute equal candidates over the whole owned area.
 */
export const orderScenarioSpaceCandidates = (
  world: WorldData, candidates: readonly Candidate[], typeId: number
): readonly Candidate[] => {
  const mine = isMineType(typeId);
  if (typeId !== 18 && !mine) return candidates;
  const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
  const ore = requiredMineOre(typeId);
  const relevantZones = new Set(world.mineZones.filter(zone => zone.ore === ore).map(zone => zone.id));
  return candidates.map(point => {
    const x = Math.min(world.cellsX - 1, point.x + Math.floor(width / 2));
    const z = Math.min(world.cellsZ - 1, point.z + Math.floor(depth / 2));
    const cell = z * world.cellsX + x, vertex = z * (world.cellsX + 1) + x;
    let prerequisite = 0;
    if (typeId === 18) prerequisite = Math.abs(Math.min(world.coastDistance[vertex]!,
      world.riverDistance[vertex]!) - Math.max(width, depth) / 2 - 1);
    if (mine) prerequisite = relevantZones.has(world.mineZone[cell]!) && world.oreAmount[cell]! > 0 ? 0 : 100000;
    const terrain = (world.waterDepth[vertex]! > .15 ? 10000 : 0) + (world.slopeClass[cell] ?? 0) * 100;
    const spread = ((point.x * 73856093 ^ point.z * 19349663) >>> 0) / 4294967296;
    return { point, score: prerequisite + terrain, spread };
  }).sort((a, b) => a.score - b.score || a.spread - b.spread || a.point.z - b.point.z || a.point.x - b.point.x)
    .map(row => row.point);
};
