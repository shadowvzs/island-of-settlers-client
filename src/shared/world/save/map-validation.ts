import { checkMapAudioAssets } from "../../../../../island-of-settlers-shared/src/script/audio";
import { isFiniteNumber, isPlainObject } from "../../../../../island-of-settlers-shared/src/validation/index";
import { validAuthoredAnimals } from "../authored-animals";
import { colonyResourcePair,isColonyResourceTier } from "../colony-resource-tiers";
import { isAuthoredRiverList } from "../editing/authored-rivers";
import { isGeneratedRiverList } from "../editing/generated-river-types";
import { validateRiverSuppressionBudget } from "../editing/river-water-suppression";
import { validEnvironmentDefaults } from "../environment-defaults";
import { validGeneratedFeatureIdentities } from "../generation/generated-feature-identities";
import { validGenerationProvenance } from "../generation/generation-provenance";
import { validGroundPalette } from "../ground-palette";
import { isMapScenario } from "../map-scenario";
import { validMarbleDeposits } from "../marble-deposit";
import { convertRetiredScenarioBanditSites } from "../scenario-bandit-sites";
import { getFormArchetype, getFormCompetition } from "../tree-forms";
import { PROP, PROP_REMOVED, PROP_TYPE_COUNT } from "../world-data";
import {
  MAP_DAMAGED,
  MAP_SIDE_RANGE,
  MapFileError,
  type MapHeader} from "./map-format";
import type { LayerArray } from "./map-layers";
import { validMapProvenance } from "./map-provenance";

export const hasNumbers = (value: unknown, keys: readonly string[]) =>
  isPlainObject(value) && keys.every((key) => isFiniteNumber(value[key]));

export const isListOf = (value: unknown, check: (item: unknown) => boolean) =>
  Array.isArray(value) && value.every(check);

const isSide = (value: unknown) =>
  Number.isInteger(value) &&
  (value as number) >= MAP_SIDE_RANGE.min &&
  (value as number) <= MAP_SIDE_RANGE.max;

const isChunk = (value: unknown) =>
  isPlainObject(value) &&
  typeof value.name === "string" &&
  ["f32", "u16", "u8"].includes(value.type as string) &&
  Number.isInteger(value.length);

/** The optional authored-with version: `contentCatalogVersion()` format, eight lower-case hex digits. */
const checkContentCatalogVersion = (value: unknown) => {
  if (value === undefined || (typeof value === "string" && /^[0-9a-f]{8}$/.test(value))) return;
  throw new MapFileError(`${MAP_DAMAGED} (content catalog version)`);
};

const SCALAR_CHECKS: [string, (value: unknown) => boolean][] = [
  ["name", (value) => typeof value === "string"],
  ["source", (value) => typeof value === "string"],
  ["savedAt", isFiniteNumber],
  ["seaLevel", isFiniteNumber],
  ["seed", isFiniteNumber],
  ["cellsX", isSide],
  ["cellsZ", isSide],
  ["propCount", (value) => Number.isInteger(value) && (value as number) >= 0]
];

const OBJECT_CHECKS: [string, (value: unknown) => boolean][] = [
  ["start", (value) => hasNumbers(value, ["x", "z"])],
  ["sun", (value) => hasNumbers(value, ["azimuthX", "azimuthZ", "elevation"])],
  ["animals", (value) => isListOf(value, (item) => hasNumbers(item, ["species", "x", "z"]))],
  ["chunks", (value) => isListOf(value, isChunk)],
  ["mineZones", (value) => isListOf(value, (item) => hasNumbers(item, ["id", "ore"]))],
  ["waterfalls", (value) => isListOf(value, (item) => hasNumbers(item, ["x", "z"]))]
];

/** The parsed header, checked field by field (a damaged or foreign header throws). */
export const checkMapHeader = (header: unknown): MapHeader => {
  if (!isPlainObject(header)) throw new MapFileError(MAP_DAMAGED);
  if (header.restoreBaselineName !== undefined && (typeof header.restoreBaselineName !== "string" || !header.restoreBaselineName.trim() || header.restoreBaselineName.length > 80))
    throw new MapFileError(`${MAP_DAMAGED} (restoreBaselineName)`);
  if (header.environmentDefaults !== undefined && !validEnvironmentDefaults(header.environmentDefaults))
    throw new MapFileError(`${MAP_DAMAGED} (environmentDefaults)`);
  if (header.groundPalette !== undefined && !validGroundPalette(header.groundPalette))
    throw new MapFileError(`${MAP_DAMAGED} (groundPalette)`);
  for (const [key, check] of [...SCALAR_CHECKS, ...OBJECT_CHECKS]) {
    if (!check(header[key])) throw new MapFileError(`${MAP_DAMAGED} (${key})`);
  }
  if (header.authoredRivers !== undefined && !isAuthoredRiverList(header.authoredRivers, header.cellsX as number, header.cellsZ as number))
    throw new MapFileError(`${MAP_DAMAGED} (authoredRivers)`);
  if (header.generatedRivers !== undefined &&
    !isGeneratedRiverList(header.generatedRivers, header.cellsX as number, header.cellsZ as number))
    throw new MapFileError(`${MAP_DAMAGED} (generatedRivers)`);
  try {
    validateRiverSuppressionBudget([...header.authoredRivers ?? [], ...header.generatedRivers ?? []],
      ((header.cellsX as number) + 1) * ((header.cellsZ as number) + 1));
  } catch { throw new MapFileError(`${MAP_DAMAGED} (river water-erasure budget)`); }
  if (header.generatedFeatureIdentities !== undefined && !validGeneratedFeatureIdentities(
    header.generatedFeatureIdentities, { cellsX: header.cellsX as number, cellsZ: header.cellsZ as number }))
    throw new MapFileError(`${MAP_DAMAGED} (generatedFeatureIdentities)`);
  if (!validAuthoredAnimals(header.animals, header.cellsX as number, header.cellsZ as number))
    throw new MapFileError(`${MAP_DAMAGED} (animal species, age, position or population)`);
  convertRetiredScenarioBanditSites(header.scenario);
  if (header.scenario !== undefined && !isMapScenario(header.scenario, header.cellsX as number, header.cellsZ as number))
    throw new MapFileError(`${MAP_DAMAGED} (scenario)`);
  if (header.colonyResourceTier !== undefined && !isColonyResourceTier(header.colonyResourceTier))
    throw new MapFileError(`${MAP_DAMAGED} (colony resource tier)`);
  if (!validMarbleDeposits(header.colonyStoneDeposits, header.cellsX as number, header.cellsZ as number) ||
    header.colonyStoneDeposits?.some(source => source.sourceProp !== undefined && source.sourceProp >= (header.propCount as number)))
    throw new MapFileError(`${MAP_DAMAGED} (colony stone sources)`);
  const colonyTier = header.colonyResourceTier;
  if (!validGenerationProvenance(header.generationProvenance))
    throw new MapFileError(`${MAP_DAMAGED} (generation provenance)`);
  if (header.generationProvenance && (header.generationProvenance.options.cellsX !== header.cellsX ||
    header.generationProvenance.options.cellsZ !== header.cellsZ || header.generationProvenance.options.seed !== header.seed))
    throw new MapFileError(`${MAP_DAMAGED} (generation provenance world identity)`);
  checkContentCatalogVersion(header.contentCatalogVersion);
  if (header.provenance !== undefined && !validMapProvenance(header.provenance))
    throw new MapFileError(`${MAP_DAMAGED} (catalog provenance)`);
  if (isColonyResourceTier(colonyTier) && header.colonyStoneDeposits?.some(source =>
    source.material !== colonyResourcePair(colonyTier).stone))
    throw new MapFileError(`${MAP_DAMAGED} (colony stone material)`);
  if (header.audioAssets !== undefined && checkMapAudioAssets(header.audioAssets).length > 0)
    throw new MapFileError(`${MAP_DAMAGED} (audioAssets)`);
  if (header.authoredTreeAges !== undefined && (!isPlainObject(header.authoredTreeAges) ||
    !Object.entries(header.authoredTreeAges).every(([id, age]) => /^(0|[1-9]\d*)$/.test(id) &&
      Number(id) < (header.propCount as number) && isFiniteNumber(age) && age >= 0 && age <= 120)))
    throw new MapFileError(`${MAP_DAMAGED} (authoredTreeAges)`);
  if (header.playableIslands !== undefined) {
    const layout = header.playableIslands;
    if (!isPlainObject(layout) || !hasNumbers(layout.minimumBuildingArea, ["width", "depth"]) ||
      !isFiniteNumber(layout.channelWidth) || !isListOf(layout.sites, site =>
        hasNumbers(site, ["x", "z", "radius", "phase", "spaceWidth", "spaceDepth", "buildingCount"]) &&
        isPlainObject(site) &&
        hasNumbers(site.headquarters, ["x", "z"]) && hasNumbers(site.harbour, ["x", "z", "rotation"]) &&
        (site.harbourSpots === undefined || isListOf(site.harbourSpots, isHarbourSpot))))
      throw new MapFileError(`${MAP_DAMAGED} (playableIslands)`);
  }
  return header as unknown as MapHeader;
};

/** HARBOUR-SPOTS entry: plot centre, quarter-turn rotation, shore workpoint, berth water point and yaw. */
const isHarbourSpot = (spot: unknown) => hasNumbers(spot, ["x", "z", "rotation", "yaw"]) && isPlainObject(spot) &&
  Number.isInteger(spot.rotation) && (spot.rotation as number) >= 0 && (spot.rotation as number) <= 3 &&
  hasNumbers(spot.land, ["x", "z"]) && hasNumbers(spot.water, ["x", "z"]);

const hasValidPropTypes = (types: LayerArray) =>
  types.every((type) => type < PROP_TYPE_COUNT || type === PROP_REMOVED);

const hasValidZoneIds = (mineZone: LayerArray, zoneCount: number) =>
  mineZone.every((id) => id <= zoneCount);

/** Content checks the renderers rely on: known prop types, mine zone ids with a record. */
export const checkMapContent = (layers: Map<string, LayerArray>, header: MapHeader) => {
  const baselineNames = ["restoreBaselineHeights", "restoreBaselineWater", "restoreBaselineLake"];
  const baselineCount = baselineNames.filter(name => layers.has(name)).length;
  if ((baselineCount !== 0 && baselineCount !== 3) || Boolean(header.restoreBaselineName) !== (baselineCount === 3) ||
    baselineNames.some(name => layers.get(name)?.some(value => !Number.isFinite(value))) ||
    layers.get("restoreBaselineLake")?.some(value => value > 1))
    throw new MapFileError(`${MAP_DAMAGED} (terrain restore baseline)`);
  const treeTypes: readonly number[] = [PROP.broadleafTree, PROP.coniferTree, PROP.birchTree,
    PROP.palmTree, PROP.cedarTree, PROP.walnutTree, PROP.mahoganyTree, PROP.hardwoodTree, PROP_REMOVED];
  if (Object.keys(header.authoredTreeAges ?? {}).some(id =>
    !treeTypes.includes(layers.get("props.types")![Number(id)]!)))
    throw new MapFileError(`${MAP_DAMAGED} (authored tree types)`);
  if (!hasValidPropTypes(layers.get("props.types")!)) {
    throw new MapFileError(`${MAP_DAMAGED} (prop types)`);
  }
  const propTypes = layers.get("props.types")!, forms = layers.get("props.form")!;
  if (propTypes.some((type, id) => (type === PROP.hardwoodTree || type === PROP.mahoganyTree) &&
    (getFormArchetype(forms[id]!) > (type === PROP.hardwoodTree ? 8 : 3) || getFormCompetition(forms[id]!) > 2)))
    throw new MapFileError(`${MAP_DAMAGED} (hardwood forms)`);
  if (!hasValidZoneIds(layers.get("mineZone")!, header.mineZones.length)) {
    throw new MapFileError(`${MAP_DAMAGED} (mine zones)`);
  }
};
