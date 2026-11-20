import { isFiniteNumber, isPlainObject } from "../../../../../island-of-settlers-shared/src/validation/index";
import { isMountainTemplate } from "../editing/terrain/mountain-template";
import type { TerrainEditState } from "../editing/terrain/terrain-edit-state";
import { getMaxLevel, type TerrainStamp } from "../editing/terrain/terrain-stamps";
import { MATERIAL_COUNT, type WorldData } from "../world-data";
import { xorBytes } from "./map-bytes";
import {
  type LayerType,
  MAP_DAMAGED,
  MapFileError,
  type MapHeader,
  type SavedTerrain
} from "./map-format";
import {
  type LayerArray,
  type LayerShape,
  type StoredLayer,
  toLayerArray,
  toStoredLayer} from "./map-layers";
import { hasNumbers, isListOf } from "./map-validation";

type BaseKey = keyof NonNullable<TerrainEditState["base"]>;
type AppliedKey = "lake" | "ring" | "rise";

const baseLayer = (key: BaseKey, type: LayerType, stride = 1) => ({
  key,
  name: `terrain.base.${key}`,
  scope: "vertex" as const,
  stride,
  type
});

const appliedLayer = (key: AppliedKey, type: LayerType) => ({
  key,
  name: `terrain.${key}`,
  scope: "vertex" as const,
  stride: 1,
  type
});

/**
 * The base ground (before the first stamp), stored XOR the world's own layer: zero bytes
 * outside the stamps, so it costs almost nothing in the gzip stream.
 */
const BASE_LAYERS = [
  baseLayer("heights", "f32"),
  baseLayer("splat", "u8", MATERIAL_COUNT),
  baseLayer("waterSurface", "f32")
];
/** What applying the stamps left per vertex (zero outside them). */
const APPLIED_LAYERS = [
  appliedLayer("rise", "f32"),
  appliedLayer("ring", "f32"),
  appliedLayer("lake", "u8")
];
/** The gravel ring cells as a cell mask (1: the stamps made the cell mine land). */
const RING_CELLS: LayerShape = { name: "terrain.ringCells", scope: "cell", stride: 1, type: "u8" };

/** Every terrain layer a map with stamps stores (after the world layers, in this order). */
export const TERRAIN_LAYERS: readonly LayerShape[] = [...BASE_LAYERS, ...APPLIED_LAYERS, RING_CELLS];

/** Whether the editor's terrain edits go into the file (only a map with stamps has any). */
const hasStamps = (state: TerrainEditState | null | undefined): state is TerrainEditState =>
  !!state?.base && !!state.rise && !!state.ring && !!state.lake && state.stamps.length > 0;

const toRingMask = (world: WorldData, cells: ReadonlySet<number>) => {
  const mask = new Uint8Array(world.cellsX * world.cellsZ);
  for (const cell of cells) mask[cell] = 1;
  return mask;
};

/** The terrain layers of the editor's state (none without stamps). */
export const listTerrainLayers = (
  world: WorldData,
  state: TerrainEditState | null | undefined
): StoredLayer[] => {
  if (!hasStamps(state)) return [];
  const base = state.base!;
  return [
    ...BASE_LAYERS.map((shape) =>
      toStoredLayer(shape, toLayerArray(shape.type, xorBytes(base[shape.key], world[shape.key])))
    ),
    ...APPLIED_LAYERS.map((shape) => toStoredLayer(shape, state[shape.key]!)),
    toStoredLayer(RING_CELLS, toRingMask(world, state.ringCells))
  ];
};

/** The header part of the editor's state (undefined without stamps). */
export const toSavedTerrain = (state: TerrainEditState | null | undefined) => {
  if (!hasStamps(state)) return undefined;
  return {
    nextId: state.nextId,
    stampProps: [...state.stampProps].map(([id, props]): [number, number[]] => [id, [...props]]),
    stamps: state.stamps.map((stamp) => ({ ...stamp }))
  } satisfies SavedTerrain;
};

const isOptionalNumber = (value: unknown) => value === undefined || isFiniteNumber(value);

const isStampLevel = (level: unknown, kind: TerrainStamp["kind"]) =>
  Number.isInteger(level) && (level as number) >= 1 && (level as number) <= getMaxLevel({ kind });

const isStamp = (value: unknown) => {
  if (!isPlainObject(value) || !hasNumbers(value, ["id", "level", "seed", "x", "z"])) return false;
  const { kind, level, template, toX, toZ } = value;
  if (kind !== undefined && kind !== "lake") return false;
  if (template !== undefined && (!isMountainTemplate(template) || kind === "lake")) return false;
  return isStampLevel(level, kind) && isOptionalNumber(toX) && isOptionalNumber(toZ);
};

const isPropId = (propCount: number) => (value: unknown) =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) < propCount;

const isStampProps = (propCount: number) => (value: unknown) =>
  Array.isArray(value) &&
  value.length === 2 &&
  Number.isInteger(value[0]) &&
  isListOf(value[1], isPropId(propCount));

const isSavedTerrain = (value: unknown, propCount: number): value is SavedTerrain =>
  isPlainObject(value) &&
  Number.isInteger(value.nextId) &&
  isListOf(value.stamps, isStamp) &&
  isListOf(value.stampProps, isStampProps(propCount));

/** Only the stamp's own fields (no unknown keys from the file). */
const toStamp = ({ id, kind, level, seed, template, toX, toZ, x, z }: TerrainStamp): TerrainStamp => ({
  id,
  kind,
  level,
  seed,
  ...(template ? { template } : {}),
  toX,
  toZ,
  x,
  z
});

const readRingCells = (mask: LayerArray) => {
  const cells = new Set<number>();
  mask.forEach((value, cell) => {
    if (value === 1) cells.add(cell);
  });
  return cells;
};

/**
 * The editor's terrain state of a loaded map (null: a version 1 file or a map without stamps):
 * checked, its base ground restored from the world layers it was stored against.
 */
export const readSavedTerrain = (
  header: MapHeader,
  layers: ReadonlyMap<string, LayerArray>
): TerrainEditState | null => {
  const saved: unknown = header.terrain;
  if (saved === undefined) return null;
  if (!isSavedTerrain(saved, header.propCount)) {
    throw new MapFileError(`${MAP_DAMAGED} (terrain)`);
  }
  const missing = TERRAIN_LAYERS.find(({ name }) => !layers.has(name));
  if (missing) throw new MapFileError(`${MAP_DAMAGED} (no ${missing.name})`);
  const take = (name: string) => layers.get(name)!;
  const base = ({ key, name, type }: (typeof BASE_LAYERS)[number]) =>
    toLayerArray(type, xorBytes(take(name), take(key)));
  const [heights, splat, waterSurface] = BASE_LAYERS.map(base);
  const [rise, ring, lake] = APPLIED_LAYERS.map(({ name }) => take(name));
  return {
    base: {
      heights: heights as Float32Array,
      splat: splat as Uint8Array,
      waterSurface: waterSurface as Float32Array
    },
    lake: lake as Uint8Array,
    nextId: saved.nextId,
    ring: ring as Float32Array,
    ringCells: readRingCells(take(RING_CELLS.name)),
    rise: rise as Float32Array,
    stampProps: new Map(saved.stampProps),
    stamps: saved.stamps.map(toStamp)
  };
};
