import type { AdventureTheme } from "../../settlement/adventure-themes";
import type { ColonyOre } from "../../settlement/colony-expedition-rules";
import { EXPEDITION_ISLAND_SIZE } from "../../settlement/colony-island-rules";
import type { ExpeditionTheme } from "../../settlement/island-discovery-policy";
import type { ColonyResourceTier } from "../colony-resource-tiers";
import { createRandom, deriveSeed } from "../rng";
import { ORE, type Ore, type WorldData } from "../world-data";
import { populateColonyHardwood } from "./colony-hardwood";
import { placeColonyStoneBoulders } from "./colony-stone-boulders";
import { applyExpeditionWorldTheme, markExpeditionWorld } from "./expedition-world-themes";
import { DEFAULT_WORLD_OPTIONS, generateWorld, type WorldOptions } from "./generate-world";

const COLONY_WORLD_SIZE = EXPEDITION_ISLAND_SIZE;

/**
 * Expensive relief passes of an expedition world (D-M5): the candidate search generates without
 * them and applies them only to the winning candidate (colony-world-choice.ts).
 */
export type ExpeditionRelief = Pick<WorldOptions, "fluvialErosion" | "peakUplift">;

/** The default relief of expedition islands (terrain-seed-v8): eroded valleys and tall summits. */
export const DEFAULT_EXPEDITION_RELIEF: ExpeditionRelief = { fluvialErosion: 1, peakUplift: 1 };
const COLONY_ORES: Readonly<Record<ColonyOre, Ore>> = {
  coal: ORE.coal, goldOre: ORE.gold, ironOre: ORE.iron, stone: ORE.granite
};
const SEED_STRIDE = 104_729;

export const colonyWorldOptions = (seed: number): WorldOptions => ({
  ...DEFAULT_WORLD_OPTIONS, cellsX: COLONY_WORLD_SIZE, cellsZ: COLONY_WORLD_SIZE,
  homeResources: false, mountainProfiles: false, mountainScale: .65, mineApronScale: 1.4,
  minimumDepositMines: 4, mountains: 1, rivers: 0, seed
});

/** Terrain palette of an island theme: winter is snowy, desert is desert, the rest are meadow. */
const getWorldTerrainTheme = (theme: AdventureTheme | undefined): WorldOptions["theme"] => {
  if (theme === "winter") return "snowy";
  return theme === "desert" ? "desert" : "meadow";
};

const getColonyForestAmount = (theme: ExpeditionTheme) => {
  if (theme === "desert") return 2;
  return theme === "forest" ? 1.2 : 1;
};

/** Every ore deposit holds the island's single ore and is already known to the colonists. */
const retagDeposits = (world: WorldData, ore: ColonyOre) => {
  for (const zone of world.mineZones) {
    if (zone.ore === ORE.none) continue;
    zone.ore = COLONY_ORES[ore];
    zone.surveyed = true;
  }
};

/**
 * One deterministic candidate island: river free, one mountain, its ore deposits retagged.
 * Returns null without an ore deposit; the caller steps `attempt` until a harbour fits too.
 */
export const generateColonyWorld = (island: { ore: ColonyOre; seed: number; theme?: ExpeditionTheme;
  resourceTier?: ColonyResourceTier }, attempt = 0, relief: ExpeditionRelief = {}) => {
  const options = { ...colonyWorldOptions((island.seed + attempt * SEED_STRIDE) >>> 0), ...relief };
  if (island.theme) {
    options.theme = getWorldTerrainTheme(island.theme);
    options.forest = getColonyForestAmount(island.theme);
    // Colony swamps stay dry/buildable: wet ground and sparse crowns need no extra flooded channels.
    options.rivers = 0;
  }
  const world = generateWorld(options);
  if (!world.mineZones.some(zone => zone.ore !== ORE.none)) return null;
  retagDeposits(world, island.ore);
  if (island.theme) applyExpeditionWorldTheme(world, island.theme, "colony");
  markExpeditionWorld(world, "colony");
  world.colonyResourceTier = island.resourceTier;
  if (island.resourceTier !== undefined) placeColonyStoneBoulders(world);
  populateColonyHardwood(world);
  return world;
};

/** Most adventures have gentle relief; occasional tall mountain islands retain variety. */
export const adventureMountainAmount = (seed: number) =>
  createRandom(deriveSeed(seed, "adventure-mountain-amount"))() < .15 ? 1 : .35;

/** Sparse themed groves leave room for field battles; legacy offers retain their original terrain. */
const ADVENTURE_FOREST: Readonly<Record<AdventureTheme, number>> = {
  desert: .55, forest: .7, swamp: .4, tropical: .55, winter: .55
};

/** Adventure islands: river free, usually gentler mountains, and the adventure's map side. */
const adventureWorldOptions = (island: { seed: number; size: number; theme?: AdventureTheme }, attempt = 0): WorldOptions => ({
  ...DEFAULT_WORLD_OPTIONS, cellsX: island.size, cellsZ: island.size, homeResources: false,
  mountains: island.theme === "swamp" ? .18 : adventureMountainAmount(island.seed),
  forest: island.theme ? ADVENTURE_FOREST[island.theme] : DEFAULT_WORLD_OPTIONS.forest,
  rivers: island.theme === "swamp" ? 2 : 0,
  theme: getWorldTerrainTheme(island.theme),
  themeLayout: "uniform", seed: (island.seed + attempt * SEED_STRIDE) >>> 0
});

export const generateAdventureWorld = (
  island: { seed: number; size: number; theme?: AdventureTheme }, attempt = 0, relief: ExpeditionRelief = {}
) => {
  const world = generateWorld({ ...adventureWorldOptions(island, attempt), ...relief });
  if (island.theme) applyExpeditionWorldTheme(world, island.theme, "adventure");
  return markExpeditionWorld(world, "adventure");
};
