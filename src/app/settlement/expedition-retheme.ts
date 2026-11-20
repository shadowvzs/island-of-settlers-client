import { OFF_SEASON_VOYAGE_MULTIPLIER } from "../../shared/balance/colonies";
import { createGameSave, type GameSaveV1 } from "../../shared/settlement/game-save";
import {
type DiscoveredIsland, type ExpeditionTheme,
  SEASON_THEME} from "../../shared/settlement/island-discovery-policy";
import { distanceToSegmentXZ } from "../../shared/settlement/settlement-geometry";
import { applyExpeditionWorldTheme } from "../../shared/world/generation/expedition-world-themes";
import { createUniformLayout } from "../../shared/world/generation/theme-field";
import { MATERIAL, MATERIAL_COUNT } from "../../shared/world/world-data";
import { stageGameSession } from "./game-session";

const changeIslandTheme = (island: DiscoveredIsland, theme: ExpeditionTheme) => {
  island.theme = theme;
  if (!island.discovery) return;
  const discovery = island.discovery;
  discovery.debug = { ...discovery.debug, theme };
  const multiplier = theme === SEASON_THEME[discovery.season] ? 1 : OFF_SEASON_VOYAGE_MULTIPLIER;
  island.voyageSeconds = Math.ceil(discovery.baseVoyageSeconds * multiplier);
};

/** Changes an expedition's environment on a detached save, preserving every gameplay record. */
export const rethemeExpedition = async (source: GameSaveV1, theme: ExpeditionTheme): Promise<GameSaveV1> => {
  const loaded = await stageGameSession(source), { settlement } = loaded, { world } = loaded.map;
  const expedition = settlement.adventure ?? settlement.colony;
  if (!expedition) throw new Error("The current island is the home island.");
  if (expedition.island.theme === theme) return source;
  const kind = settlement.adventure ? "adventure" : "colony";
  const protectedGround = { contains: (x: number, z: number) =>
    settlement.buildings.some(b => Math.abs(b.x - x) < b.width / 2 + 3 && Math.abs(b.z - z) < b.depth / 2 + 3) ||
    settlement.roads.some(road => distanceToSegmentXZ(x, z, road.start.x, road.start.z, road.end.x, road.end.z) < 2) ||
    settlement.actors.some(actor => Math.hypot(actor.x - x, actor.z - z) < 3 ||
      actor.path.some(point => Math.hypot(point.x - x, point.z - z) < 2)) ||
    (settlement.adventure?.campSites ?? []).some(site => Math.hypot(site.x - x, site.z - z) < 6) };
  let base: "meadow" | "desert" | "snowy" = "meadow";
  if (theme === "desert") base = "desert";
  if (theme === "winter") base = "snowy";
  world.themeWeights = createUniformLayout(base)({ grid: world, heights: world.heights });
  for (let vertex = 0; vertex < world.heights.length; vertex++) {
    if (world.heights[vertex]! <= world.seaLevel + .2 || world.waterDepth[vertex]! > 0) continue;
    const x = vertex % (world.cellsX + 1), z = Math.floor(vertex / (world.cellsX + 1));
    if (protectedGround.contains(x, z)) continue;
    const offset = vertex * MATERIAL_COUNT, rock = world.splat[offset + MATERIAL.rock]!;
    const mine = world.splat[offset + MATERIAL.mine]!, available = Math.max(0, 255 - rock - mine);
    world.splat.fill(0, offset, offset + MATERIAL_COUNT);
    world.splat[offset + MATERIAL.rock] = rock; world.splat[offset + MATERIAL.mine] = mine;
    let ground: number = MATERIAL.grass;
    if (theme === "winter") ground = MATERIAL.snow;
    if (theme === "desert") ground = MATERIAL.sand;
    world.splat[offset + ground] = available;
  }
  applyExpeditionWorldTheme(world, theme, kind, protectedGround);
  changeIslandTheme(expedition.island, theme);
  const group = source.archipelago ? structuredClone(source.archipelago) : undefined;
  const record = [...group?.colonies ?? [], ...group?.adventures ?? []]
    .find(entry => entry.expeditionId === group?.active);
  if (record) changeIslandTheme(record.island, theme);
  const result = await createGameSave(world, settlement, { ...loaded.map.meta,
    animals: loaded.map.animals, terrain: loaded.map.terrain, savedAt: source.savedAt }, loaded.runtime);
  return { ...result, player: source.player, archipelago: group };
};
