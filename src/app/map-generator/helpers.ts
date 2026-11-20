import { type ColonyResourceTier,isColonyResourceTier } from "../../shared/world/colony-resource-tiers";
import { maxPlayableIslandCount } from "../../shared/world/generation/archipelago-rules";
import {
  DEFAULT_WORLD_OPTIONS,
  type WorldOptions
} from "../../shared/world/generation/generate-world";
import { isIslandTheme, type IslandTheme } from "../../shared/world/generation/island-themes";
import { isLandform, type Landform } from "../../shared/world/generation/landforms";
import { isThemeLayoutKind, type ThemeLayoutKind } from "../../shared/world/generation/theme-field";
import { clamp } from "../../shared/world/noise";

/** What the player picks for a new island (World settings form and URL parameters). */
export interface IslandChoice {
  /** MC-07 tall cliff bands 0..1 (?cliffBands=); 0 and absent are off (the default). */
  cliffBands?: number;
  /** Explicit replacement-map preset; absent means ordinary home resources. */
  colonyResourceTier?: ColonyResourceTier;
  /** M03 stream-power valley strength 0..1 (?fluvialErosion=); 0 and absent are off (Relief: Massif). */
  fluvialErosion?: number;
  /** Forest coverage 0..4 (None / Few / Normal / Many / Very many). */
  forest: number;
  /** HARBOUR-SPOTS (?harbourSpots=1): store pre-levelled harbour spots; only with more than one island. */
  harbourSpots?: boolean;
  /** Minimum trunk spacing in cells: 1.65 (default), 1.4 or 1.2. */
  treeSpacing?: number;
  /** null: chosen by the seed (Random). */
  landform: Landform | null;
  similarIslandSizes?: boolean;
  islandCount?: number;
  /** Mountains 0..4 (None / Few / Normal / Many / Very many). */
  mountains: number;
  /** MC-04 summit uplift 0..1 (?peakUplift=); 0 and absent keep the classic peaks (Peaks: Classic). */
  peakUplift?: number;
  /** Relief variation 0..4 (Flat .. Very hilly); omitted legacy choices keep their old engine options. */
  terrainVariation?: number;
  /** Rivers 0..2 (Off / Few: one river / Normal). */
  rivers: number;
  /** Independent dimensions; omitted in legacy square-map settings. */
  width?: number;
  height?: number;
  /** Legacy square size, also the fallback for an omitted dimension (64..1024). */
  size: number;
  theme: IslandTheme;
  /** uniform: the theme everywhere; landmass: each island of an archipelago its own theme. */
  themeLayout: ThemeLayoutKind;
}

export const MAP_SIZES = [64, 128, 192, 256, 512, 1024] as const;
const MIN_MAP_SIZE = MAP_SIZES[0];
const MAX_MAP_SIZE = MAP_SIZES[MAP_SIZES.length - 1]!;
const DEFAULT_FOREST = 1;
const DEFAULT_MOUNTAINS = 2;
const MAX_AMOUNT = 4;
const DEFAULT_TERRAIN_VARIATION = 2;
const terrainVariationLevel = (value = DEFAULT_TERRAIN_VARIATION) =>
  Number.isFinite(value) ? clamp(Math.round(value), 0, MAX_AMOUNT) : DEFAULT_TERRAIN_VARIATION;
/**
 * River count per level (Off / Few / Normal), per 128 x 128 reference area. Few asks for the
 * smallest count, which the world scaling rounds up to exactly one river on every map size.
 */
const RIVER_COUNTS = [0, 0.01, DEFAULT_WORLD_OPTIONS.rivers] as const;
/** New islands start with rivers disabled; the selector can still enable them. */
const DEFAULT_RIVERS = 0;

/** Default relief of a new island (owner 2026-11-07, terrain-seed-v8): eroded valleys, tall summits. */
const DEFAULT_FLUVIAL_EROSION = 1;
const DEFAULT_PEAK_UPLIFT = 1;

export const DEFAULT_ISLAND_CHOICE: IslandChoice = {
  fluvialErosion: DEFAULT_FLUVIAL_EROSION,
  forest: DEFAULT_FOREST,
  landform: null,
  similarIslandSizes: false,
  islandCount: 1,
  mountains: DEFAULT_MOUNTAINS,
  peakUplift: DEFAULT_PEAK_UPLIFT,
  terrainVariation: DEFAULT_TERRAIN_VARIATION,
  rivers: DEFAULT_RIVERS,
  size: DEFAULT_WORLD_OPTIONS.cellsX,
  theme: DEFAULT_WORLD_OPTIONS.theme,
  themeLayout: DEFAULT_WORLD_OPTIONS.themeLayout
};

/** Relief choice of the form: plain massifs (no carving) or stream-power eroded valleys (M03). */
export type Relief = "eroded" | "massif";
/** Carving strength of the Eroded relief (the strength the M03 captures were reviewed at). */
const ERODED_RELIEF_STRENGTH = DEFAULT_FLUVIAL_EROSION;

export const reliefOf = (choice: Pick<IslandChoice, "fluvialErosion">): Relief =>
  choice.fluvialErosion ? "eroded" : "massif";

export const fluvialErosionFor = (relief: Relief) => relief === "eroded" ? ERODED_RELIEF_STRENGTH : 0;

/** Peak choice of the form: today's massif crests or the uplifted tall summits (MC-04). */
export type Peaks = "classic" | "tall";
/** Uplift strength of the Tall peaks. */
const TALL_PEAK_UPLIFT = DEFAULT_PEAK_UPLIFT;

export const peaksOf = (choice: Pick<IslandChoice, "peakUplift">): Peaks => choice.peakUplift ? "tall" : "classic";

export const peakUpliftFor = (peaks: Peaks) => peaks === "tall" ? TALL_PEAK_UPLIFT : 0;

/** The cliff band option of a checkbox (on: full strength). */
export const cliffBandsFor = (enabled: boolean) => (enabled ? 1 : 0);

/** Map side clamped to the supported 64..1024 cells (whole cells). */
export const clampMapSize = (size: number) => clamp(Math.round(size), MIN_MAP_SIZE, MAX_MAP_SIZE);

const readFiniteNumber = (query: URLSearchParams, key: string) => {
  const value = Number(query.get(key));
  return query.has(key) && Number.isFinite(value) ? value : null;
};

const readAmount = (query: URLSearchParams, key: string, fallback: number, maximum = MAX_AMOUNT) => {
  const value = readFiniteNumber(query, key);
  return value === null ? fallback : clamp(Math.round(value), 0, maximum);
};

const readIslandCount = (query: URLSearchParams, fallback = 1) => {
  const value = readFiniteNumber(query, "islandCount");
  if (value === null) return fallback;
  return Math.max(1, Math.round(value));
};

const readTreeSpacing = (query: URLSearchParams, fallback?: number) => {
  const value = readFiniteNumber(query, "treeSpacing");
  return value === 1.65 || value === 1.4 || value === 1.2 ? value : fallback;
};

const readSize = (query: URLSearchParams, fallback: number, key = "size") => {
  const value = readFiniteNumber(query, key);
  return value === null ? fallback : clampMapSize(value);
};

/** A 0..1 relief strength option: the query over the stored choice; 0 and absent both mean off (omitted). */
const readStrength = (query: URLSearchParams, base: IslandChoice,
  key: "cliffBands" | "fluvialErosion" | "peakUplift") => {
  const value = readFiniteNumber(query, key);
  const strength = value === null ? base[key] ?? 0 : clamp(value, 0, 1);
  return strength > 0 ? { [key]: strength } : {};
};

/** ?harbourSpots=1 over the stored choice; off is omitted, like the other optional switches. */
const readHarbourSpots = (query: URLSearchParams, base: IslandChoice) => {
  const enabled = query.has("harbourSpots") ? query.get("harbourSpots") === "1" : Boolean(base.harbourSpots);
  return enabled ? { harbourSpots: true } : {};
};

/**
 * The choice in a query (?landform, rivers, forest, mountains, size, theme, themeLayout) over
 * `base`.
 */
export const readIslandChoice = (query: URLSearchParams, base: IslandChoice): IslandChoice => {
  const landform = query.get("landform");
  const theme = query.get("theme");
  const themeLayout = query.get("themeLayout");
  const legacySize = readSize(query, base.size);
  const width = readSize(query, query.has("size") ? legacySize : base.width ?? legacySize, "width");
  const height = readSize(query, query.has("size") ? legacySize : base.height ?? legacySize, "height");
  const size = width;
  const selectedLandform = isLandform(landform) ? landform : base.landform;
  const legacySingle = selectedLandform === "island";
  const tier = query.has("colonyTier") ? Number(query.get("colonyTier")) : base.colonyResourceTier;
  return {
    ...(isColonyResourceTier(tier) ? { colonyResourceTier: tier } : {}),
    ...readStrength(query, base, "cliffBands"),
    ...readStrength(query, base, "fluvialErosion"),
    ...readStrength(query, base, "peakUplift"),
    islandCount: legacySingle ? 1 : clamp(readIslandCount(query, base.islandCount), 1, maxPlayableIslandCount(width, height)),
    similarIslandSizes: query.has("similarIslands") ? query.get("similarIslands") === "1" : base.similarIslandSizes ?? false,
    ...readHarbourSpots(query, base),
    forest: readAmount(query, "forest", base.forest),
    treeSpacing: readTreeSpacing(query, base.treeSpacing),
    landform: legacySingle ? "archipelago" : selectedLandform,
    mountains: readAmount(query, "mountains", base.mountains),
    ...(query.has("terrainVariation") || base.terrainVariation !== undefined
      ? { terrainVariation: terrainVariationLevel(readAmount(query, "terrainVariation", base.terrainVariation ?? DEFAULT_TERRAIN_VARIATION)) }
      : {}),
    rivers: readAmount(query, "rivers", base.rivers, 2),
    size,
    ...(width === height ? {} : { width, height }),
    theme: isIslandTheme(theme) ? theme : base.theme,
    themeLayout: isThemeLayoutKind(themeLayout) ? themeLayout : base.themeLayout
  };
};

/** Writes a choice into a query; defaults are left out, so plain URLs stay short. */
export const writeIslandQuery = (query: URLSearchParams, choice: IslandChoice) => {
  const { height, width } = islandDimensions(choice);
  const rectangular = width !== height;
  const entries: [string, string, boolean][] = [
    ["cliffBands", String(choice.cliffBands ?? 0), !choice.cliffBands],
    ["colonyTier", String(choice.colonyResourceTier ?? ""), choice.colonyResourceTier === undefined],
    ["fluvialErosion", String(choice.fluvialErosion ?? 0),
      (choice.fluvialErosion ?? 0) === DEFAULT_ISLAND_CHOICE.fluvialErosion],
    ["width", String(width), !rectangular],
    ["height", String(height), !rectangular],
    ["islandCount", String(choice.islandCount ?? 1), !choice.islandCount || choice.islandCount === 1],
    ["similarIslands", "1", !choice.similarIslandSizes],
    ["harbourSpots", "1", !choice.harbourSpots],
    ["forest", String(choice.forest), choice.forest === DEFAULT_ISLAND_CHOICE.forest],
    ["treeSpacing", String(choice.treeSpacing ?? 1.65), (choice.treeSpacing ?? 1.65) === 1.65],
    ["landform", choice.landform ?? "", choice.landform === null],
    ["mountains", String(choice.mountains), choice.mountains === DEFAULT_ISLAND_CHOICE.mountains],
    ["peakUplift", String(choice.peakUplift ?? 0), (choice.peakUplift ?? 0) === DEFAULT_ISLAND_CHOICE.peakUplift],
    ["terrainVariation", String(terrainVariationLevel(choice.terrainVariation)),
      terrainVariationLevel(choice.terrainVariation) === DEFAULT_TERRAIN_VARIATION],
    ["rivers", String(choice.rivers), choice.rivers === DEFAULT_ISLAND_CHOICE.rivers],
    ["size", String(width), rectangular || width === DEFAULT_ISLAND_CHOICE.size],
    ["theme", choice.theme, choice.theme === DEFAULT_ISLAND_CHOICE.theme],
    ["themeLayout", choice.themeLayout, choice.themeLayout === DEFAULT_ISLAND_CHOICE.themeLayout]
  ];
  for (const [key, value, isDefault] of entries) {
    if (isDefault) query.delete(key);
    else query.set(key, value);
  }
  return query;
};

/** Stored as a query string: the same parsing and validation as the URL. */
export const formatIslandChoice = (choice: IslandChoice) =>
  writeIslandQuery(new URLSearchParams(), choice).toString();

export const parseIslandChoice = (text: string | null) =>
  readIslandChoice(new URLSearchParams(text ?? ""), DEFAULT_ISLAND_CHOICE);

/** Resolve legacy square settings at the boundary; the generator already accepts rectangles. */
const islandDimensions = (choice: IslandChoice) => ({
  width: clampMapSize(choice.width ?? choice.size),
  height: clampMapSize(choice.height ?? choice.size)
});

/** The generation options of a choice (river level to a count, size scaled counts). */
/** The requested island count, clamped to what the map dimensions hold. */
const islandCountOf = (choice: IslandChoice) =>
  clamp(choice.islandCount || 1, 1, maxPlayableIslandCount(islandDimensions(choice).width, islandDimensions(choice).height));

/** Harbour spots need a second island to sail to; a one-island map never stores them. */
const wantsHarbourSpots = (choice: IslandChoice, islandCount: number) =>
  Boolean(choice.harbourSpots) && islandCount > 1;

export const toWorldOptions = (
  choice: IslandChoice
): Omit<WorldOptions, "erosionDroplets" | "seed"> => ({
  ...(choice.cliffBands ? { cliffBands: choice.cliffBands } : {}),
  ...(choice.colonyResourceTier ? { colonyResourceTier: choice.colonyResourceTier } : {}),
  ...(choice.fluvialErosion ? { fluvialErosion: choice.fluvialErosion } : {}),
  islandCount: islandCountOf(choice),
  similarIslandSizes: choice.similarIslandSizes ?? false,
  ...(wantsHarbourSpots(choice, islandCountOf(choice)) ? { harbourSpots: true } : {}),
  cellsX: islandDimensions(choice).width,
  cellsZ: islandDimensions(choice).height,
  forest: [0, .35, 1, 1.5, 2][choice.forest] ?? .35,
  // Few keeps its sparse forest mask but only half of that mask's tree candidates. Older maps
  // without this option regenerate exactly as before.
  ...(choice.forest === 1 ? { treeDensity: 0.45 } : {}),
  ...(choice.treeSpacing !== undefined && choice.treeSpacing !== 1.65
    ? { treeSpacing: choice.treeSpacing }
    : {}),
  landform: choice.landform === "island" ? "archipelago" : choice.landform,
  mountains: [0, .35, 1, 1.5, 2][choice.mountains] ?? .35,
  ...(choice.peakUplift ? { peakUplift: choice.peakUplift } : {}),
  ...(choice.terrainVariation === undefined ? {} : { terrainVariation: [0, .5, 1, 1.5, 2][terrainVariationLevel(choice.terrainVariation)]! }),
  rivers: RIVER_COUNTS[Math.round(choice.rivers)] ?? DEFAULT_WORLD_OPTIONS.rivers,
  theme: choice.theme,
  themeLayout: choice.themeLayout
});

/** A form edits its own draft, leaving settings, map data and editor history untouched. */
export const createIslandDraft = (initial: IslandChoice): IslandChoice & { height: number; width: number } => {
  const { height, width } = islandDimensions(initial);
  return { ...initial, height, width, terrainVariation: terrainVariationLevel(initial.terrainVariation),
    landform: initial.landform === "island" ? "archipelago" : initial.landform,
    islandCount: initial.landform === "island" ? 1 : initial.islandCount || 1 };
};

/** Replacement preserves dimensions/seed at the adapter boundary; preset selection never retags live props. */
export const replacementIslandChoice = (initial: IslandChoice,
  world: { cellsX: number; cellsZ: number }, colonyResourceTier: IslandChoice["colonyResourceTier"]): IslandChoice =>
  ({ ...initial, width: world.cellsX, height: world.cellsZ, size: world.cellsX, colonyResourceTier });

/** The generator form's draft: explicit dimensions and an island count that fits them. */
export type IslandDraft = ReturnType<typeof createIslandDraft>;

/** Island count choices of a map: one up to the playable maximum of its dimensions. */
export const getIslandCountOptions = (width: number, height: number) =>
  Array.from({ length: maxPlayableIslandCount(width, height) }, (_, index) =>
    ({ label: String(index + 1), value: index + 1 }));

/** Applies a form edit, keeping the island count within what the (new) dimensions can hold. */
export const updateIslandDraft = (draft: IslandDraft, patch: Partial<IslandDraft>): IslandDraft => {
  const next = { ...draft, ...patch };
  const maximum = maxPlayableIslandCount(next.width, next.height);
  return { ...next, terrainVariation: terrainVariationLevel(next.terrainVariation),
    islandCount: Math.min(maximum, Math.max(1, next.islandCount || 1)) };
};

/**
 * A home island choice. The colony tier belongs only to the editor's explicit replacement map (a scenario
 * draft); playable colonies come from the expedition system, so stored and form choices never keep it.
 */
export const withoutColonyTier = <T extends IslandChoice>(choice: T): T => {
  const home = { ...choice };
  delete home.colonyResourceTier;
  return home;
};

/** The form's starting draft (home resources, dimensions resolved, island count clamped). */
export const createIslandFormDraft = (initial: IslandChoice) =>
  updateIslandDraft(createIslandDraft(withoutColonyTier(initial)), {});

/** What the form shows for a draft: island count choices and which conditional parts appear. */
export const getIslandFormState = (draft: IslandDraft) => ({
  countOptions: getIslandCountOptions(draft.width, draft.height),
  harbourSpots: draft.harbourSpots ?? false,
  islandCount: draft.islandCount ?? 1,
  showHarbourSpots: draft.landform === "archipelago" && (draft.islandCount ?? 1) > 1,
  showIslandOptions: draft.landform === "archipelago",
  similarSizes: draft.similarIslandSizes ?? false,
  similarSizesDisabled: draft.islandCount === 1
});

/** The optional seed field: empty asks for a new random island. */
export const readSeedField = (value: string, valueAsNumber: number) => (value === "" ? undefined : valueAsNumber);
