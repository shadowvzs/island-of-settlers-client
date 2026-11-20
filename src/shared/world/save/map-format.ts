import type { HeaderScriptFields } from "../../../../../island-of-settlers-shared/src/script/codec";
import type { AuthoredAnimal as PlacedAnimal } from "../authored-animals";
import type { TerrainStamp } from "../editing/terrain/terrain-stamps";
import type { PlayableIslandLayout } from "../world-data";
import type { MineZone, SunDirection, Waterfall } from "../world-data";

/**
 * Saved map file (`.island`): the envelope (magic, version, codec byte, compressed payload of the
 * JSON header and the layer chunks) lives in the shared package (`map-file.ts`), so the API can read
 * header scripts without the client. Layer chunks follow the header's chunk table.
 * Version 2: the editor's terrain stamps (version 1 files have none and still load).
 * Version 3: near-copy layers as XOR residuals (map-prediction.ts) and the codec byte of the prefix
 * (version 1 and 2 files are gzip: their codec byte is 0).
 */
export {
  checkMapPrefix, MAP_CODEC_OFFSET, MAP_CODECS, MAP_DAMAGED, MAP_FORMAT_VERSION, MAP_MAGIC, MAP_PREFIX_BYTES,
  type MapCodec, MapFileError, MIN_MAP_FORMAT_VERSION
} from "../../../../../island-of-settlers-shared/src/map-file";
export const MAP_FILE_EXTENSION = ".island";
/** Map sides a file may claim (a sanity bound, the game makes 64 .. 512). */
export const MAP_SIDE_RANGE = { max: 1024, min: 8 } as const;

/** Initial authored wildlife; runtime growth and movement belong to game saves. */
export type { AuthoredAnimal as PlacedAnimal } from "../authored-animals";

/** What the player names and the app adds to a saved map. */
export interface MapMeta {
  /**
   * The content catalog version (`contentCatalogVersion()`, shared package) the map was authored with: the map
   * editor stores it on save and warns on load when the running game has another. Absent in older files.
   */
  contentCatalogVersion?: string;
  name: string;
  /** The exact published catalog revision this copy came from, when it has one. */
  provenance?: import("./map-provenance").MapProvenance;
  savedAt: number;
  /** How the island was first generated (the app's own text, e.g. its island choice). */
  source: string;
}

/** One stored layer: its name (see map-layers.ts), element type and element count. */
export interface ChunkInfo {
  length: number;
  name: string;
  type: LayerType;
}

export type LayerType = "f32" | "u16" | "u8";

/**
 * The editor's mountain and lake stamps (version 2, only when the map has any): with the terrain
 * layers (`terrain.*`: the base ground, the applied rise, ring and lake, the ring cells) a
 * loaded map lowers and resets its stamps as before the save.
 */
export interface SavedTerrain {
  nextId: number;
  /** World props of each stamp (boulders, water plants): [stamp id, prop ids]. */
  stampProps: [number, number[]][];
  stamps: TerrainStamp[];
}

/**
 * The JSON header: the world's scalars and objects, the placed animals, the chunk table and the
 * optional map script (`script`, `scriptHash`, `scriptReadsEnvironment`; TRG1).
 */
export interface MapHeader extends MapMeta, HeaderScriptFields {
  restoreBaselineName?: string;
  colonyResourceTier?: import("../colony-resource-tiers").ColonyResourceTier;
  generationProvenance?: import("../generation/generation-provenance").GenerationProvenance;
  colonyStoneDeposits?: import("../marble-deposit").MarbleDeposit[];
  environmentDefaults?: import("../environment-defaults").EnvironmentDefaults;
  groundPalette?: import("../ground-palette").GroundPalette;
  authoredTreeAges?: Record<number, number>;
  /** Uploaded map audio (base64, bounded by `MAP_AUDIO_LIMITS`); absent on maps without uploads. */
  audioAssets?: import("../../../../../island-of-settlers-shared/src/script/audio").MapAudioAsset[];
  authoredRivers?: import("../editing/authored-rivers").AuthoredRiver[];
  generatedRivers?: import("../editing/generated-river-types").GeneratedRiver[];
  generatedFeatureIdentities?: import("../generation/generated-feature-identities").GeneratedFeatureIdentity[];
  scenario?: import("../map-scenario").MapScenario;
  playableIslands?: PlayableIslandLayout;
  animals: PlacedAnimal[];
  cellsX: number;
  cellsZ: number;
  chunks: ChunkInfo[];
  mineZones: MineZone[];
  propCount: number;
  seaLevel: number;
  seed: number;
  start: { x: number; z: number };
  sun: SunDirection;
  terrain?: SavedTerrain;
  waterfalls: Waterfall[];
}
