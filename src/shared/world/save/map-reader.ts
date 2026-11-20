import { inflateMapPayload, splitMapHeader } from "../../../../../island-of-settlers-shared/src/map-file";
import { decodeHeaderScript } from "../../../../../island-of-settlers-shared/src/script/codec";
import type { TerrainEditState } from "../editing/terrain/terrain-edit-state";
import { createFog } from "../generation/sectors";
import { computeNormals } from "../lighting";
import type { MapScenario } from "../map-scenario";
import { decodePropPositionTicks, decodePropRotationTicks, decodePropScaleTicks, propPhase } from "../prop-quantum";
import { assignScenarioObjectIds } from "../scenario-object-ids";
import type { PropSet, WorldData } from "../world-data";
import { fromBytePlanes } from "./map-bytes";
import {
  checkMapPrefix,
  MAP_DAMAGED,
  MapFileError,
  type MapHeader,
  type MapMeta,
  type PlacedAnimal
} from "./map-format";
import {
  getLayerLength,
  type LayerArray,
  type LayerShape,
  MAP_LAYERS,
  toLayerArray,
  TYPE_BYTES} from "./map-layers";
import { applyResiduals, baseLayerName, hasResidualRule, isResidualName, residualName } from "./map-prediction";
import { readSavedTerrain, TERRAIN_LAYERS } from "./map-terrain";
import { checkMapContent, checkMapHeader } from "./map-validation";

/**
 * A loaded map: the world as saved (normals and fog made again), what the editor placed and its
 * terrain stamps (null when the map has none, e.g. a version 1 file).
 */
export interface LoadedMap {
  animals: PlacedAnimal[];
  meta: MapMeta;
  terrain: TerrainEditState | null;
  world: WorldData;
}

/** Every layer a file may hold: the world's, then the editor's terrain layers. */
const STORED_LAYERS: readonly LayerShape[] = [...MAP_LAYERS, ...TERRAIN_LAYERS];

const QUANTISED_PROP_DECODERS: Record<string, (ticks: number) => number> = {
  "props.x": decodePropPositionTicks,
  "props.z": decodePropPositionTicks,
  "props.rotation": decodePropRotationTicks,
  "props.scale": decodePropScaleTicks
};

/** The layer a chunk holds: a plain layer, or a residual of a predicted layer (map format 3). */
const findChunkLayer = (chunkName: string) => {
  if (isResidualName(chunkName) && !hasResidualRule(baseLayerName(chunkName))) return undefined;
  return STORED_LAYERS.find(({ name }) => name === baseLayerName(chunkName));
};

/** The header checked field by field, its script decoded (structure, hash, flag) and frozen. */
const checkHeaderWithScript = (header: unknown) => {
  const checked = checkMapHeader(header);
  const script = decodeHeaderScript(checked as unknown as Record<string, unknown>);
  if (script) checked.script = script.script;
  return checked;
};

/** The checked JSON header and where the chunks start. */
const readHeader = (payload: Uint8Array) => {
  const { header, offset } = splitMapHeader(payload);
  try {
    return { header: checkHeaderWithScript(header), offset };
  } catch (error) {
    if (error instanceof MapFileError) throw error;
    throw new MapFileError(MAP_DAMAGED);
  }
};

/** Whether the layer is present, plain or as a residual chunk. */
const isStored = (layers: Map<string, LayerArray>, name: string) =>
  layers.has(name) || layers.has(residualName(name));

/** Every layer of the chunk table, checked against the layer list and the map size. */
const readLayers = (payload: Uint8Array, header: MapHeader, start: number) => {
  const layers = new Map<string, LayerArray>();
  let offset = start;
  for (const chunk of header.chunks) {
    const spec = findChunkLayer(chunk.name);
    if (!spec || !(spec.acceptedTypes ?? [spec.type]).includes(chunk.type) || isStored(layers, spec.name)) {
      throw new MapFileError(`${MAP_DAMAGED} (layer ${chunk.name})`);
    }
    const byteLength = getLayerLength(spec, header) * TYPE_BYTES[chunk.type];
    if (chunk.length !== getLayerLength(spec, header) || offset + byteLength > payload.length) {
      throw new MapFileError(`${MAP_DAMAGED} (layer ${chunk.name} size)`);
    }
    const planes = payload.subarray(offset, offset + byteLength);
    layers.set(chunk.name, toLayerArray(chunk.type, fromBytePlanes(planes, TYPE_BYTES[chunk.type])));
    offset += byteLength;
  }
  if (offset !== payload.length) throw new MapFileError(MAP_DAMAGED);
  // Quantised prop layers are decoded into the ordinary float PropSet the rest of the app reads.
  for (const [name, decode] of Object.entries(QUANTISED_PROP_DECODERS)) {
    const array = layers.get(name);
    if (array instanceof Uint16Array) layers.set(name, Float32Array.from(array, decode));
  }
  const missing = MAP_LAYERS.find((spec) => !spec.optional && !isStored(layers, spec.name));
  if (missing) throw new MapFileError(`${MAP_DAMAGED} (no ${missing.name})`);
  applyResiduals(layers);
  return layers;
};

const createLayerReader = (layers: Map<string, LayerArray>) => ({
  f32: (name: string) => layers.get(name) as Float32Array,
  u16: (name: string) => layers.get(name) as Uint16Array,
  u8: (name: string) => layers.get(name) as Uint8Array
});

type LayerReader = ReturnType<typeof createLayerReader>;

const assembleProps = (take: LayerReader, count: number, seed: number, hasPhase: boolean): PropSet => ({
  count,
  form: take.u8("props.form"),
  phase: hasPhase ? take.f32("props.phase") : Float32Array.from({ length: count }, (_, id) => propPhase(seed, id)),
  rotation: take.f32("props.rotation"),
  scale: take.f32("props.scale"),
  types: take.u8("props.types"),
  x: take.f32("props.x"),
  y: take.f32("props.y"),
  z: take.f32("props.z")
});

/** Legacy maps get their stable object ids once, deterministically, when they are read (ACT1). */
const withScenarioObjectIds = (scenario: MapScenario) => {
  assignScenarioObjectIds(scenario);
  return scenario;
};

/** The world of the header and layers; the normals and the start fog are derived again. */
const assembleWorld = (header: MapHeader, layers: Map<string, LayerArray>): WorldData => {
  const take = createLayerReader(layers);
  const { cellsX, cellsZ, start } = header;
  const heights = take.f32("heights");
  const sector = take.u16("sector");
  const startSector = sector[Math.floor(start.z) * cellsX + Math.floor(start.x)] ?? 0;
  return {
    restoreBaselineName: header.restoreBaselineName,
    colonyResourceTier: header.colonyResourceTier,
    generationProvenance: header.generationProvenance && structuredClone(header.generationProvenance),
    expeditionKind: header.colonyResourceTier !== undefined ? "colony" : undefined,
    colonyStoneDeposits: header.colonyStoneDeposits && structuredClone(header.colonyStoneDeposits),
    restoreBaselineHeights: layers.has("restoreBaselineHeights") ? take.f32("restoreBaselineHeights") : undefined,
    restoreBaselineWater: layers.has("restoreBaselineWater") ? take.f32("restoreBaselineWater") : undefined,
    restoreBaselineLake: layers.has("restoreBaselineLake") ? take.u8("restoreBaselineLake") : undefined,
    authoredRivers: header.authoredRivers && structuredClone(header.authoredRivers),
    generatedRivers: header.generatedRivers && structuredClone(header.generatedRivers),
    generatedFeatureIdentities: header.generatedFeatureIdentities && structuredClone(header.generatedFeatureIdentities),
    environmentDefaults: header.environmentDefaults && { ...header.environmentDefaults },
    groundPalette: header.groundPalette && { ...header.groundPalette },
    scenario: header.scenario && withScenarioObjectIds(structuredClone(header.scenario)),
    script: header.script,
    authoredTreeAges: header.authoredTreeAges && { ...header.authoredTreeAges },
    audioAssets: header.audioAssets?.map(asset => ({ ...asset })),
    playableIslands: header.playableIslands,
    ambientOcclusion: take.u8("ambientOcclusion"),
    blocking: take.u8("blocking"),
    buildCap: take.u8("buildCap"),
    buildClass: take.u8("buildClass"),
    cellsX,
    cellsZ,
    coastDistance: take.f32("coastDistance"),
    flow: take.f32("flow"),
    fog: createFog({ cellsX, cellsZ }, sector, startSector),
    heightLevels: take.u8("heightLevels"),
    heights,
    clearedStoneGround: layers.has("clearedStoneGround") ? take.u8("clearedStoneGround") : undefined,
    roadGradeBase: layers.has("roadGradeBase") ? take.f32("roadGradeBase") : undefined,
    roadGradeApplied: layers.has("roadGradeApplied") ? take.f32("roadGradeApplied") : undefined,
    lakeWater: layers.has("lakeWater") ? take.u8("lakeWater") : undefined,
    groundVariants: layers.has("groundVariants") ? take.u8("groundVariants") : undefined,
    coverPaint: layers.has("coverPaint") ? take.u8("coverPaint") : undefined,
    mineZone: take.u16("mineZone"),
    mineZones: header.mineZones,
    moisture: take.u8("moisture"),
    normals: computeNormals({ cellsX, cellsZ }, heights),
    oreAmount: take.u8("oreAmount"),
    props: assembleProps(take, header.propCount, header.seed, layers.has("props.phase")),
    riverDistance: take.f32("riverDistance"),
    seaLevel: header.seaLevel,
    sector,
    seed: header.seed,
    slopeClass: take.u8("slopeClass"),
    splat: take.u8("splat"),
    start: { x: start.x, z: start.z },
    sun: header.sun,
    sunShadow: take.u8("sunShadow"),
    themeWeights: take.u8("themeWeights"),
    walkCost: take.u8("walkCost"),
    waterDepth: take.f32("waterDepth"),
    waterSurface: take.f32("waterSurface"),
    waterfalls: header.waterfalls,
    wetRock: take.u8("wetRock")
  };
};

/**
 * Reads a map file (map-writer.ts): checks the magic, version, header and every layer's size,
 * so a foreign, newer or damaged file throws a MapFileError with a message for the player.
 */
export const readMapFile = async (bytes: Uint8Array): Promise<LoadedMap> => {
  checkMapPrefix(bytes);
  const payload = await inflateMapPayload(bytes);
  const { header, offset } = readHeader(payload);
  const layers = readLayers(payload, header, offset);
  checkMapContent(layers, header);
  const { animals, contentCatalogVersion, name, provenance, savedAt, source } = header;
  const authoredWith = contentCatalogVersion === undefined ? {} : { contentCatalogVersion };
  return {
    animals,
    meta: { ...authoredWith, name, provenance: provenance && { ...provenance }, savedAt, source },
    terrain: readSavedTerrain(header, layers),
    world: assembleWorld(header, layers)
  };
};
