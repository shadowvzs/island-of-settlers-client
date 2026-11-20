import type { MapParts } from "../../../../../island-of-settlers-shared/src/save-map-delta";
import { encodeHeaderScript } from "../../../../../island-of-settlers-shared/src/script/codec";
import type { TerrainEditState } from "../editing/terrain/terrain-edit-state";
import {
  fitsU16Ticks, isExactPropPosition, isExactPropRotation, isExactPropScale,
  propPositionTicks, propRotationTicks, propScaleTicks
} from "../prop-quantum";
import type { WorldData } from "../world-data";
import { chooseMapCodec, compressBytes, createByteWriter, toBytePlanes } from "./map-bytes";
import {
  type ChunkInfo,
  MAP_CODEC_OFFSET,
  MAP_CODECS,
  MAP_FORMAT_VERSION,
  MAP_MAGIC,
  MAP_PREFIX_BYTES,
  type MapCodec,
  type MapHeader,
  type MapMeta,
  type PlacedAnimal
} from "./map-format";
import { type LayerArray, MAP_LAYERS, type StoredLayer, toStoredLayer, TYPE_BYTES } from "./map-layers";
import { hasResidualRule, RESIDUAL_RULES, residualName, toResidual } from "./map-prediction";
import { listTerrainLayers, toSavedTerrain } from "./map-terrain";

/** What a save stores besides the world. */
export interface MapSaveInput extends MapMeta {
  animals: readonly PlacedAnimal[];
  /** The editor's mountain and lake stamps (stored when there are any). */
  terrain?: TerrainEditState | null;
}

/** Predicted layers (map-prediction.ts) are stored as their residual against the other layers. */
const toResidualLayers = (layers: StoredLayer[]): StoredLayer[] => {
  const byName = new Map(layers.map(({ array, info }) => [info.name, array]));
  return layers.map((layer) => {
    const { name } = layer.info;
    if (!hasResidualRule(name)) return layer;
    const rule = RESIDUAL_RULES.find((entry) => entry.name === name)!;
    const array = toResidual(rule, layer.array as Float32Array, byName);
    return { array, info: { ...layer.info, name: residualName(name) } };
  });
};

type PropQuantumCodec = {
  exact: (value: number) => boolean;
  ticks: (value: number) => number;
};

/** The four prop layers the map can store on the quantised grids. */
const PROP_QUANTUM_CODECS: Record<string, PropQuantumCodec> = {
  "props.x": { exact: isExactPropPosition, ticks: propPositionTicks },
  "props.z": { exact: isExactPropPosition, ticks: propPositionTicks },
  "props.rotation": { exact: isExactPropRotation, ticks: propRotationTicks },
  "props.scale": { exact: isExactPropScale, ticks: propScaleTicks }
};

/** A prop layer as u16 when every value is exactly on the quantised grid, else its f32 array. */
const quantisedProp = (name: string, array: LayerArray): LayerArray | undefined => {
  const codec = PROP_QUANTUM_CODECS[name];
  if (!(array instanceof Float32Array) || !codec) return undefined;
  for (const value of array) if (!codec.exact(value)) return undefined;
  const encoded = Uint16Array.from(array, codec.ticks);
  return encoded.every(value => fitsU16Ticks(value)) ? encoded : undefined;
};

const listStoredLayers = (world: WorldData, terrain: MapSaveInput["terrain"]): StoredLayer[] => [
  ...toResidualLayers(MAP_LAYERS.flatMap((spec) => {
    const array = spec.get(world);
    if (!array || spec.name === "props.phase") return [];
    const quantised = quantisedProp(spec.name, array);
    return [quantised ? toStoredLayer({ ...spec, type: "u16" }, quantised) : toStoredLayer(spec, array)];
  })),
  ...listTerrainLayers(world, terrain)
];

/**
 * The header: survey state is game progress, so every deposit is saved unsurveyed (fog of war and
 * surveys belong to a later "save game", not to a map).
 */
const createHeader = (world: WorldData, input: MapSaveInput, chunks: ChunkInfo[]): MapHeader => {
  const { animals, contentCatalogVersion, name, provenance, savedAt, source, terrain } = input;
  return {
    // Undefined fields are left out of the JSON header: maps saved without a version keep their bytes.
    contentCatalogVersion,
    provenance: provenance && { ...provenance },
    restoreBaselineName: world.restoreBaselineName,
    colonyResourceTier: world.colonyResourceTier,
    generationProvenance: world.generationProvenance && structuredClone(world.generationProvenance),
    colonyStoneDeposits: world.colonyStoneDeposits && structuredClone(world.colonyStoneDeposits),
    environmentDefaults: world.environmentDefaults && { ...world.environmentDefaults },
    groundPalette: world.groundPalette && { ...world.groundPalette },
    authoredTreeAges: world.authoredTreeAges && { ...world.authoredTreeAges },
    // Left out when empty: maps without uploaded audio keep their bytes.
    audioAssets: world.audioAssets?.length ? world.audioAssets.map(asset => ({ ...asset })) : undefined,
    authoredRivers: world.authoredRivers && structuredClone(world.authoredRivers),
    generatedRivers: world.generatedRivers && structuredClone(world.generatedRivers),
    generatedFeatureIdentities: world.generatedFeatureIdentities && structuredClone(world.generatedFeatureIdentities),
    scenario: world.scenario && structuredClone(world.scenario),
    playableIslands: world.playableIslands,
    animals: animals.map(({ age, species, x, z }) => ({ species, x, z, ...(age === undefined ? {} : { age }) })),
    cellsX: world.cellsX,
    cellsZ: world.cellsZ,
    chunks,
    mineZones: world.mineZones.map((zone) => ({ ...zone, surveyed: false })),
    name,
    propCount: world.props.count,
    savedAt,
    seaLevel: world.seaLevel,
    seed: world.seed,
    source,
    start: { ...(world.scenario?.headquarters ?? world.start) },
    sun: { ...world.sun },
    terrain: toSavedTerrain(terrain),
    waterfalls: world.waterfalls.map((waterfall) => ({ ...waterfall })),
    // Maps without a script get none of the script fields, so their bytes stay identical (TRG1).
    ...encodeHeaderScript(world.script)
  };
};

const createPrefix = (codec: MapCodec) => {
  const prefix = new Uint8Array(MAP_PREFIX_BYTES);
  prefix.set(new TextEncoder().encode(MAP_MAGIC));
  new DataView(prefix.buffer).setUint16(4, MAP_FORMAT_VERSION, true);
  prefix[MAP_CODEC_OFFSET] = MAP_CODECS.indexOf(codec);
  return prefix;
};

const encodeHeaderLength = (length: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, length, true);
  return bytes;
};

/**
 * The map file's content before compression. The delta codec compares these pieces with a base
 * directly, so a save never has to compress and inflate the whole map just to find the changes.
 */
export const writeMapParts = (world: WorldData, input: MapSaveInput, codec: MapCodec = "gzip"): MapParts => {
  const layers = listStoredLayers(world, input.terrain);
  const header = new TextEncoder().encode(JSON.stringify(createHeader(world, input, layers.map(({ info }) => info))));
  const chunks = new Map<string, Uint8Array>();
  for (const { array, info } of layers) chunks.set(info.name, toBytePlanes(array, TYPE_BYTES[info.type]));
  return { chunks, header, prefix: createPrefix(codec) };
};

/** The raw (uncompressed) payload of the parts: header length, header, then the layers in table order. */
export const joinMapPayload = ({ chunks, header }: MapParts) => {
  const payload = createByteWriter();
  payload.push(encodeHeaderLength(header.length));
  payload.push(header);
  for (const bytes of chunks.values()) payload.push(bytes);
  return payload.join();
};

/** The compressed map file of the parts; `options.codec` forces a codec, else `chooseMapCodec` picks one. */
export const compressMapParts = async (parts: MapParts, options: { codec?: MapCodec } = {}) => {
  const bytes = joinMapPayload(parts);
  const codec = options.codec ?? await chooseMapCodec(bytes);
  const file = createByteWriter();
  file.push(createPrefix(codec));
  file.push(await compressBytes(bytes, codec));
  return file.join();
};

/**
 * The map file of the world (see map-format.ts): the edited world itself, not the edits, so a
 * load needs no generation. Pure apart from the compression stream, no DOM. The codec is brotli
 * where the platform compresses it fast (`chooseMapCodec`), else gzip; `options.codec` forces one.
 */
export const writeMapFile = (world: WorldData, input: MapSaveInput, options: { codec?: MapCodec } = {}) =>
  compressMapParts(writeMapParts(world, input), options);
