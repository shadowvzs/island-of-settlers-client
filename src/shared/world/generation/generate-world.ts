import type { Nation } from "../../../../../island-of-settlers-shared/src/nations";
import { placeHarbourSpots } from "../../settlement/generated-harbour-spots";
import { improveGeneratedOreCapacity } from "../../settlement/settlement-generated-ore-capacity";
import { createBuildCap, createBuildClass } from "../build-class";
import { type ColonyResourceTier,isColonyResourceTier } from "../colony-resource-tiers";
import { GENERATED_RIVER_LIMIT } from "../editing/generated-river-types";
import type { GridSize } from "../grid-geometry";
import { bakeTerrainLight, computeNormals, DEFAULT_SUN } from "../lighting";
import { createRandom, deriveSeed } from "../rng";
import { createStillWater } from "../still-water";
import type { WorldData } from "../world-data";
import { PROP, PROP_REMOVED } from "../world-data";
import {
  clipIslandCoasts,
  ISLAND_SPACE,
  islandHeadquarters,
  type IslandSite,
  planPlayableIslands,
  shapePlayableIslands
} from "./archipelago-rules";
import { lowerBeaches } from "./beaches";
import { applyCliffBands } from "./cliff-bands";
import { applyGeneratedColonyPreset } from "./colony-generation-preset";
import { DEFAULT_WORLD_OPTIONS } from "./default-world-options";
import { computeCoastDistance, computeDistanceField, computeSeaDistance } from "./distance-field";
import { erodeTerrain, smoothLand } from "./erosion";
import { applyFluvialErosion } from "./fluvial-erosion";
import { createCellTerrain } from "./gameplay";
import type { GeneratedFeatureIdentity } from "./generated-feature-identities";
import { createGeneratedRiverCapture } from "./generated-river-capture";
import { TERRAIN_GENERATOR_VERSION, validGenerationProvenance } from "./generation-provenance";
import {
  applyTerraces,
  createBaseHeights,
  createHeightLevels,
  createShapeFields,
  getOpenBorderDistance,
  lowerOpenBorder,
  OPEN_BORDER_BAND
} from "./heights";
import { ensureHomeResources } from "./home-resources";
import { createHydrology } from "./hydrology";
import type { IslandTheme } from "./island-themes";
import {
  createIslandUplandShape,
  createReservedRiverKeepOut,
  getIslandUplandMountains,
  growIslandsForRivers,
  ISLAND_UPLAND_RIVER_LENGTH,
  wantsIslandUplands
} from "./island-uplands";
import { chooseLandform, createLandformLayout, type Landform } from "./landforms";
import { applyCloverMeadows, createBiomeFields, type MaterialInputs } from "./materials";
import { placeMineZones } from "./mine-zones";
import { applyMountainProfileRelief } from "./mountain-profile-relief";
import { getOptionsNationAffinity, nationRiverAmount, nationWetness } from "./nation-terrain-bias";
import { choosePlateaus, flattenPlateaus } from "./plateaus";
import { preparePlayableIslands } from "./playable-islands";
import { carveRivers } from "./river-carving";
import { findRiverCourses } from "./river-paths";
import { createWetRock } from "./river-wetness";
import { createRoughGround } from "./rough-ground";
import { shapeSeabed } from "./seabed";
import { createFog, createSectors } from "./sectors";
import { limitSlopes } from "./slope-limit";
import { roundSummitCrowns } from "./summit-crowns";
import { upliftSummits } from "./summit-uplift";
import { applySurfaceDetail } from "./surface-detail";
import { applyTerrainVariation } from "./terrain-variation";
import {
  createThemeLayout,
  createThemeSampler,
  type ThemeLayout,
  type ThemeLayoutKind
} from "./theme-field";
import { createTopographyFields } from "./topography-fields";
import { placeVegetation } from "./vegetation";
import { createWalkCost } from "./walkability";
import { createWaterLayers } from "./water";
import { scaleCount } from "./world-scale";

export interface WorldOptions {
  /** Explicit standalone map authoring preset; absent retains home/adventure generation. */
  colonyResourceTier?: ColonyResourceTier;
  similarIslandSizes?: boolean;
  islandCount?: number;
  /**
   * HARBOUR-SPOTS: store a few validated, pre-levelled harbour spots per island (Islands maps with
   * more than one island; generator option 'Potential harbour spots'). Absent or false stores none.
   */
  harbourSpots?: boolean;
  cellsX: number;
  cellsZ: number;
  /** Droplets per 128 x 128 reference area (scaled with the map area). */
  erosionDroplets: number;
  /**
   * M03 pilot: stream-power valley carving 0..1 on massifs and high hills before the droplet pass
   * (fluvial-erosion.ts); absent or 0 keeps today's relief.
   */
  fluvialErosion?: number;
  /**
   * MC-04 summit uplift 0..1: the upper massifs rise (a 13-unit crest to about 20 at 1) with
   * steeper talus there (summit-uplift.ts); absent or 0 keeps today's peaks.
   */
  peakUplift?: number;
  /**
   * MC-07 tall cliff bands 0..1 (map generator / editor option, off by default): terrace contours
   * step by three levels with ramps between band segments (cliff-bands.ts); absent or 0 keeps none.
   */
  cliffBands?: number;
  /** Forest coverage 0..2 (1 = default): thins or widens the groves. */
  forest: number;
  /** Optional map-authoring tree thinning (1 = unchanged): scales accepted tree candidates only. */
  treeDensity?: number;
  /** Minimum trunk spacing in cells (1.65 = default forest, 1.4 / 1.2 = denser). */
  treeSpacing?: number;
  /** Forced landform (?landform=); null picks it from the seed. */
  landform: Landform | null;
  /** Mountains 0..2 (1 = default): count, extent and height; 0 leaves only hills. */
  mountains: number;
  /**
   * NATION-TERRAIN (owner 2026-11-18): the nation whose homeland landscape the island leans to (tree mix,
   * forest amount, ground wetness, river amount). A bias only: the same generator invariants and resource
   * guarantees run afterwards. Absent keeps the neutral generation.
   */
  nation?: Nation;
  /** Inland relief amplitude 0..2: flat / natural (1) / very hilly; absent retains legacy shaping. */
  terrainVariation?: number;
  /** Conservative imported cliff relief; false is an internal baseline comparison. */
  mountainProfiles?: boolean;
  /** Internal island profile: scales massifs without removing their seeded centres. */
  mountainScale?: number;
  /** Width multiplier for gentle mineral foothills; ordinary maps keep their existing width. */
  mineApronScale?: number;
  /**
   * Home island guarantee (coal, iron and quarry stone near the HQ, home-resources.ts); expedition
   * islands and internal baselines pass false. Colony resource presets never get it.
   */
  homeResources?: boolean;
  /** Internal ore capacity audit baseline; production keeps this enabled. */
  oreCapacity?: boolean;
  /** Minimum compatible plots per generated deposit; colonies reserve a wider mining shelf. */
  minimumDepositMines?: number;
  /** Rivers per 128 x 128 reference area (grows slower than the area); 0 for none. */
  rivers: number;
  seed: number;
  /** The selected theme (meadow = the tuned default). */
  theme: IslandTheme;
  /** Uniform, per-landmass, altitude/latitude bands or seeded blended natural regions. */
  themeLayout: ThemeLayoutKind;
}

/** Re-exported for the existing generator callers. */
export { DEFAULT_WORLD_OPTIONS };

const SEA_LEVEL = 0;
/** Cap (cells) of the signed coast distance: a cell distance, independent of the map size. */
const COAST_LIMIT = 32;
/** Building plateaus (start included) per 128 x 128 reference area. */
const PLATEAUS_PER_REFERENCE = 3;
/** Rivers grow with the area to this power: each river drains a bigger catchment. */
export const RIVER_AREA_EXPONENT = 0.8;
/** Building plateaus (and so the start) keep this far beyond the lowered open border band. */
const START_EDGE_CLEARANCE = 8;
/** No river through the start settlement (cells around the start). */
const START_RIVER_CLEARANCE = 10;
/** Cliff bands keep this far (cells) from every island's HQ and the start. */
const START_BAND_CLEARANCE = 25;

/** Upland islands find springs on most massifs, so they keep within the editable source limit. */
const getRiverCount = (grid: GridSize, rivers: number, uplands: boolean) => {
  const count = scaleCount(grid, rivers, RIVER_AREA_EXPONENT);
  return uplands ? Math.min(count, GENERATED_RIVER_LIMIT) : count;
};

interface CliffBandContext {
  fields: ReturnType<typeof createShapeFields>;
  islandSites: IslandSite[] | undefined;
  isNearOpenBorder: (x: number, z: number) => boolean;
  plateauMask: Float32Array;
  seed: number;
  start: { x: number; z: number };
}

/** MC-07: tall cliff bands away from every HQ, plateau and the open border, with their own slope limit. */
const addCliffBands = (grid: GridSize, heights: Float32Array, context: CliffBandContext, amount?: number) => {
  if (!amount) return;
  const { fields, islandSites, isNearOpenBorder, plateauMask, seed, start } = context;
  const centres = [start, ...(islandSites ?? []).map(islandHeadquarters)];
  const stride = grid.cellsX + 1;
  const keepOut = (x: number, z: number) => isNearOpenBorder(x, z) || plateauMask[z * stride + x]! > 0 ||
    centres.some(centre => Math.hypot(centre.x - x, centre.z - z) < START_BAND_CLEARANCE);
  const talus = applyCliffBands(grid, heights, fields, seed, amount, { keepOut, start });
  if (talus) limitSlopes(grid, heights, fields.continentalness, talus);
};

/** Heights up to the traced river courses; traced again once when islands grow for the rivers. */
const shapeRelief = (
  grid: GridSize,
  seed: number,
  options: WorldOptions,
  islandSites: IslandSite[] | undefined,
  onPhase?: (phase: string) => void
) => {
  onPhase?.("Shaping island and mountain sources");
  const landform = options.landform ?? chooseLandform(seed);
  const layout = createLandformLayout(seed, landform);
  const uplands = wantsIslandUplands(islandSites, options.rivers) ? islandSites : undefined;
  const reliefSites = uplands ?? (options.terrainVariation !== undefined ? islandSites : undefined);
  const mountains = uplands ? getIslandUplandMountains(options.mountains) : options.mountains;
  const islandShape = reliefSites && createIslandUplandShape(reliefSites);
  // Dry islands may have hills too, without forcing river-source massifs at Mountains: None.
  if (islandShape && !uplands) islandShape.minimumMassifs = 0;
  const fields = createShapeFields(grid, seed, layout, mountains, islandShape);
  let featureIdentities: GeneratedFeatureIdentity[] = [];
  const { beachScale, heights } = createBaseHeights(grid, seed, fields, mountains, options.mountainScale,
    features => { featureIdentities = features; });
  const summitTalus = upliftSummits(grid, heights, fields.mountainMask, options.peakUplift);
  if (options.fluvialErosion) {
    onPhase?.("Carving river valleys");
    applyFluvialErosion(grid, heights, fields, options.fluvialErosion);
  }
  onPhase?.("Eroding and smoothing terrain");
  erodeTerrain(grid, heights, seed, scaleCount(grid, options.erosionDroplets));
  smoothLand(grid, heights);
  limitSlopes(grid, heights, fields.continentalness, summitTalus);
  roundSummitCrowns(grid, heights, fields.mountainMask);
  onPhase?.("Adding ground surface detail");
  applySurfaceDetail(grid, heights, fields, seed);
  applyTerraces(heights, fields);
  lowerBeaches(heights, beachScale, fields, SEA_LEVEL);
  lowerOpenBorder(grid, heights, layout);
  if (options.terrainVariation !== undefined) {
    applyTerrainVariation(heights, options.terrainVariation);
    limitSlopes(grid, heights, fields.continentalness, summitTalus);
  }
  if (islandSites) shapePlayableIslands(grid, heights, islandSites);
  const isNearOpenBorder = (x: number, z: number) =>
    getOpenBorderDistance(grid, layout, x, z) < OPEN_BORDER_BAND + START_EDGE_CLEARANCE;
  const plateauCount = scaleCount(grid, PLATEAUS_PER_REFERENCE);
  const plateaus = choosePlateaus(grid, heights, plateauCount, isNearOpenBorder);
  const plateauMask = flattenPlateaus(grid, heights, plateaus);
  const islandStart = islandSites?.[0] && islandHeadquarters(islandSites[0]);
  const start = islandStart ?? plateaus[0] ?? { x: grid.cellsX / 2, z: grid.cellsZ / 2 };
  addCliffBands(grid, heights, { fields, islandSites, isNearOpenBorder, plateauMask, seed, start }, options.cliffBands);
  const river = {
    avoid: uplands && createReservedRiverKeepOut(uplands),
    count: getRiverCount(grid,
      nationRiverAmount(options.rivers, getOptionsNationAffinity(options)), uplands !== undefined),
    keepOut: { radius: START_RIVER_CLEARANCE, x: start.x, z: start.z },
    minLength: uplands && ISLAND_UPLAND_RIVER_LENGTH
  };
  const riverRandom = createRandom(deriveSeed(seed, "rivers"));
  onPhase?.("Tracing and carving connected rivers");
  const riverCourses = findRiverCourses(grid, heights, SEA_LEVEL, river, riverRandom);
  const missingRivers = river.count - riverCourses.length;
  return { cliffMask: fields.cliffMask, featureIdentities, heights, isNearOpenBorder, missingRivers, plateauMask,
    riverCourses, start, uplands };
};

const planIslandSites = (grid: GridSize, seed: number, options: WorldOptions) => {
  if (options.landform !== "archipelago") return undefined;
  return planPlayableIslands(grid, seed, options.similarIslandSizes, options.islandCount);
};

/**
 * Islands relief for the requested river total: when the planned uplands hold too few rivers, small
 * islands with room grow (island-uplands.ts) and the relief is shaped once more on the grown sites;
 * the grown islands are kept only when they hold more rivers than the planned ones.
 */
const shapeIslandRelief = (
  grid: GridSize,
  seed: number,
  options: WorldOptions,
  onPhase?: (phase: string) => void
) => {
  const islandSites = planIslandSites(grid, seed, options);
  const relief = shapeRelief(grid, seed, options, islandSites, onPhase);
  if (!relief.uplands) return { islandSites, relief };
  const grownSites = growIslandsForRivers(grid, relief.uplands, relief.missingRivers);
  if (!grownSites) return { islandSites, relief };
  const grownRelief = shapeRelief(grid, seed, options, grownSites, onPhase);
  if (grownRelief.missingRivers >= relief.missingRivers) return { islandSites, relief };
  return { islandSites: grownSites, relief: grownRelief };
};

/**
 * Terrain shape: heights, erosion, cliffs, building plateaus, the theme layout (per area theme
 * weights), rivers and water.
 */
export const shapeTerrain = (
  grid: GridSize,
  seed: number,
  options: WorldOptions,
  themeLayout: ThemeLayout,
  onPhase?: (phase: string) => void
) => {
  const { islandSites, relief } = shapeIslandRelief(grid, seed, options, onPhase);
  const { cliffMask, featureIdentities, heights, isNearOpenBorder, plateauMask, riverCourses, start } = relief;
  const themeWeights = themeLayout({ grid, heights, seed });
  const theme = createThemeSampler(grid, themeWeights, options.forest, false,
    getOptionsNationAffinity(options));
  const riverWidth = (x: number, z: number) => theme.at(x, z).riverWidth;
  const riverCapture = createGeneratedRiverCapture(grid, heights, SEA_LEVEL, riverWidth);
  const rivers = carveRivers(grid, heights, riverCourses, SEA_LEVEL, riverWidth, riverCapture);
  if (islandSites) {
    shapePlayableIslands(grid, heights, islandSites, true);
    clipIslandCoasts(grid, heights, islandSites, rivers.mask);
  }
  shapeSeabed(grid, seed, { heights, riverMask: rivers.mask, seaLevel: SEA_LEVEL });
  const water = createWaterLayers(grid, heights, rivers.surface, SEA_LEVEL);
  return { islandSites, cliffMask, heights, isNearOpenBorder, plateauMask,
    riverCapture, featureIdentities, rivers, start, theme, themeWeights, water };
};

/**
 * Builds the whole island deterministically from the seed (pure, worker friendly). The theme
 * layout follows the options (one theme, or one per landmass); other strategies plug in here.
 */
const generateWorldAttempt = (
  options: WorldOptions = DEFAULT_WORLD_OPTIONS,
  themeLayout: ThemeLayout = createThemeLayout(options.theme, options.themeLayout),
  recordProvenance = true,
  onPhase?: (phase: string) => void
): WorldData => {
  if (options.colonyResourceTier !== undefined && !isColonyResourceTier(options.colonyResourceTier))
    throw new RangeError("Unknown colony resource preset");
  const { seed } = options;
  const grid: GridSize = { cellsX: options.cellsX, cellsZ: options.cellsZ };
  const shape = shapeTerrain(grid, seed, options, themeLayout, onPhase);
  const { cliffMask, heights, isNearOpenBorder, plateauMask, rivers, start, theme, themeWeights, water } =
    shape;
  const coastDistance = computeCoastDistance(grid, water.waterDepth, COAST_LIMIT);
  const riverDistance = computeDistanceField(grid, (index) => rivers.mask[index] === 1);
  const hydrology = createHydrology(grid, heights, SEA_LEVEL);
  const topography = createTopographyFields(grid, heights);
  const { waterDepth, waterSurface } = water;
  onPhase?.("Placing mineral deposits");
  const mine = placeMineZones(grid, seed, {
    depositBandScale: options.mineApronScale,
    coastDistance,
    heights,
    isNearOpenBorder,
    plateauMask,
    riverDistance,
    start,
    waterDepth
  });
  const inputs: MaterialInputs = {
    coastDistance,
    heights,
    massifContact: mine.massifContact,
    massifFoot: mine.massifFoot,
    mineGround: mine.mineGround,
    mineZone: mine.mineZone,
    plateauMask,
    riverDistance,
    seaDistance: computeSeaDistance(grid, waterDepth, riverDistance),
    stillWater: createStillWater(grid, {
      flow: rivers.flow,
      riverDistance,
      seaLevel: SEA_LEVEL,
      waterfalls: rivers.waterfalls,
      waterSurface
    }),
    theme,
    waterDepth,
    waterSurface,
    wetness: hydrology.wetness,
    topography
  };
  onPhase?.("Building biomes and vegetation");
  const biome = createBiomeFields(grid, seed, inputs, options.forest,
    nationWetness(getOptionsNationAffinity(options)));
  const { blocking, buildCap, buildClass, props, slopeClass, splat } = placeVegetation(
    grid,
    seed,
    inputs,
    biome,
    start,
    options.treeDensity,
    options.treeSpacing
  );
  if (options.forest <= 0) {
    const trees = new Set<number>([PROP.broadleafTree, PROP.coniferTree, PROP.birchTree, PROP.palmTree, PROP.sapling]);
    for (let index = 0; index < props.count; index++) if (trees.has(props.types[index]!)) props.types[index] = PROP_REMOVED;
    blocking.set(createCellTerrain(grid, { heights, props, waterDepth }).blocking);
    buildClass.set(createBuildClass({ ...grid, blocking, slopeClass, buildCap }));
  }
  if (options.mountainProfiles !== false) {
    const changed = applyMountainProfileRelief({ ...grid, blocking, cliffMask, coastDistance, heights, mineZone: mine.mineZone,
    props, riverDistance, seed, slopeClass, start, waterDepth },
    options.mountains * (options.terrainVariation ?? 1));
    if (changed) {
      const rough = createRoughGround(grid, { heights, riverDistance, splat });
      buildCap.set(createBuildCap(grid, { ...rough, mineZone: mine.mineZone, slopeClass }));
      buildClass.set(createBuildClass({ ...grid, blocking, slopeClass, buildCap }));
    }
  }
  onPhase?.("Building navigation and terrain lighting");
  const sector = createSectors(grid, seed, blocking, start);
  const startSector = sector[Math.floor(start.z) * grid.cellsX + Math.floor(start.x)] ?? 0;
  const light = bakeTerrainLight(grid, heights, water.waterSurface, DEFAULT_SUN);
  const world: WorldData = {
    ...grid,
    ...light,
    blocking,
    buildCap,
    buildClass,
    coastDistance: inputs.coastDistance,
    flow: rivers.flow,
    fog: createFog(grid, sector, startSector),
    heightLevels: createHeightLevels(heights),
    heights,
    mineZone: mine.mineZone,
    mineZones: mine.mineZones,
    moisture: Uint8Array.from(biome.moisture, (value) => Math.round(value * 255)),
    normals: computeNormals(grid, heights),
    oreAmount: mine.oreAmount,
    props,
    riverDistance: inputs.riverDistance,
    seaLevel: SEA_LEVEL,
    sector,
    seed,
    slopeClass,
    splat,
    start: { x: start.x, z: start.z },
    sun: DEFAULT_SUN,
    themeWeights,
    waterDepth,
    waterSurface,
    wetRock: createWetRock(grid, heights, inputs.riverDistance, rivers.waterfalls),
    walkCost: createWalkCost(grid, slopeClass, blocking, splat, props),
    waterfalls: rivers.waterfalls
  };
  onPhase?.("Checking usable mineral work areas");
  if (options.oreCapacity !== false) improveGeneratedOreCapacity(world, options.minimumDepositMines);
  if (shape.islandSites) {
    onPhase?.("Validating reserved building space and harbour approaches");
    preparePlayableIslands(world, shape.islandSites);
  }
  if (options.colonyResourceTier === undefined && options.homeResources !== false) {
    onPhase?.("Securing home stone, coal and iron");
    ensureHomeResources(world);
  }
  if (options.colonyResourceTier !== undefined) applyGeneratedColonyPreset(world, options.colonyResourceTier);
  if (shape.islandSites && options.harbourSpots) {
    onPhase?.("Choosing and levelling potential harbour spots");
    placeHarbourSpots(world);
  }
  applyCloverMeadows(grid, seed, world.splat, inputs, biome);
  onPhase?.("Finalizing editable source metadata");
  world.generatedRivers = shape.riverCapture.finish(world);
  world.generatedFeatureIdentities = shape.featureIdentities;
  const provenance = { version: 1, generatorVersion: TERRAIN_GENERATOR_VERSION, options: { ...options, seed: world.seed } };
  if (recordProvenance && validGenerationProvenance(provenance)) world.generationProvenance = provenance;
  return world;
};

/** Explicit Islands requests get two deterministic retries, then fail without accepting an unusable map. */
export const generateWorld = (options: WorldOptions = DEFAULT_WORLD_OPTIONS,
  themeLayout?: ThemeLayout, onPhase?: (phase: string) => void): WorldData => {
  const layout = themeLayout ?? createThemeLayout(options.theme, options.themeLayout);
  if (options.landform !== "archipelago") return generateWorldAttempt(options, layout, themeLayout === undefined, onPhase);
  let failure: unknown;
  for (let attempt = 0; attempt <= ISLAND_SPACE.retries; attempt++) {
    try {
      return generateWorldAttempt({ ...options, seed: attempt === 0 ? options.seed : deriveSeed(options.seed, `islands-retry-${attempt}`) }, layout, themeLayout === undefined, onPhase);
    } catch (error) { failure = error; }
  }
  throw new Error(`Could not create valid islands after three attempts. ${failure instanceof Error ? failure.message : "Choose a larger map."}`);
};
