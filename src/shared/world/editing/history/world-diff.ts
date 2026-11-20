import { type CellRegion } from "../../grid-geometry";
import { clearTerrainLightCache } from "../../lighting";
import { type LayerArray,type LayerShape,MAP_LAYERS } from "../../save/map-layers";
import { type MineZone, PROP_REMOVED, type WorldData } from "../../world-data";
import { resizeProps } from "../prop-set";
import type { TerrainEditState } from "../terrain/terrain-edit-state";
import {
  copyTerrainMeta,
  copyZones,
  type DiffSide,
  getTerrainMetaBytes,
  getZonesBytes,
  isSameZones,
  isTerrainChanged,
  restoreTerrainMeta,
  restoreZones,
  type Sides,
  type TerrainMeta
} from "./history-meta";
import {
  copyLayer,
  createZeroLayer,
  findChangedSpans,
  getSpanBytes,
  type LayerSpan,
  writeSpan} from "./layer-spans";

/** A layer an edit can change: the saved map layers, the normals, the terrain tool's arrays. */
interface TrackedLayer {
  get: () => LayerArray | null | undefined;
  name: string;
}

export interface LayerChange {
  name: string;
  spans: LayerSpan[];
}

/** What one edit changed in the world (and the terrain tool's state), both versions. */
export interface WorldDiff {
  /** Memory the diff keeps. */
  bytes: number;
  layers: LayerChange[];
  propCount: Sides<number>;
  terrain: Sides<TerrainMeta> | null;
  zones: Sides<MineZone[]> | null;
  rivers?: Sides<WorldData["authoredRivers"]>;
  generatedRivers?: Sides<WorldData["generatedRivers"]>;
  featureIdentities?: Sides<WorldData["generatedFeatureIdentities"]>;
  waterfalls?: Sides<WorldData["waterfalls"]>;
  scenario?: Sides<WorldData["scenario"]>;
  treeAges?: Sides<WorldData["authoredTreeAges"]>;
  stoneDeposits?: Sides<WorldData["colonyStoneDeposits"]>;
  environment?: Sides<WorldData["environmentDefaults"]>;
  groundPalette?: Sides<WorldData["groundPalette"]>;
}

/** Removed/restored also includes transformed standing props, whose static instances must be replaced. */
export interface PropChanges {
  removed: number[];
  restored: number[];
}

const TERRAIN_ARRAYS = ["lake", "ring", "rise"] as const;

/**
 * The actual cells a local edit can change (its brush or stamp bounds), not the whole map.
 * `undefined` keeps the original whole-map capture/diff. A snapshot captures only the affected
 * rows of the local layers; the global layers below stay fully scanned.
 */
export interface WorldEditScope {
  cells: CellRegion;
  /**
   * Whether the edit can change the water field. A water edit recomputes the whole coast
   * distance, so that layer falls back to a full scan; false lets a local edit bound it.
   */
  waterChanged?: boolean;
}

/**
 * Layers an edit derives from the whole island (coast/river distance fields, flow and wet-rock
 * fields) or from the complete prop list. A local scope cannot prove their changes stay inside
 * the edit bounds, so they keep the full capture and diff scan.
 */
const GLOBAL_LAYERS: ReadonlySet<string> = new Set([
  "coastDistance", "flow", "riverDistance", "wetRock"
]);

/** Extra rows a bounded layer reads or writes beyond the edit's cells. */
const ROW_HALO: ReadonlyMap<string, number> = new Map([
  // Normals read the one-vertex neighbour of a changed height.
  ["normals", 1],
  // The light bake adds the shadow reach (48) and the AO reach (7) around the changed vertices.
  ["ambientOcclusion", 55],
  ["sunShadow", 55],
  // Build layers recompute their class two cells around the edit.
  ["blocking", 2], ["buildCap", 2], ["buildClass", 2], ["slopeClass", 2], ["walkCost", 2],
  ["mineZone", 2], ["oreAmount", 2]
]);

/** Rows of a layer a bounded capture keeps before and after an edit. */
interface RowPatch {
  /** First entry of the first row. */
  start: number;
  values: LayerArray;
}

/** Captured before values of one tracked layer: full when its bounds are not provable. */
interface LayerCapture {
  /** Reusable whole-layer buffer (the current full capture behavior). */
  buffer: LayerArray | null;
  /** `undefined`: not captured, null: the layer did not exist. */
  full: LayerArray | null | undefined;
  patches: RowPatch[];
}

const shapeOf = (name: string): LayerShape | undefined => {
  const spec = MAP_LAYERS.find((layer) => layer.name === name);
  if (spec) return spec;
  if (name === "normals") return { name, scope: "vertex", stride: 3, type: "f32" };
  if (name.startsWith("terrain.base.")) {
    const stride = name.endsWith(".splat") ? 9 : 1;
    return { name, scope: "vertex", stride, type: name.endsWith(".heights") ||
      name.endsWith(".waterSurface") ? "f32" : "u8" };
  }
  if (name.startsWith("terrain."))
    return { name, scope: "vertex", stride: 1, type: name.endsWith(".lake") ? "u8" : "f32" };
  return undefined;
};

/** Entries of one full row of a layer. */
const rowLengthOf = (world: WorldData, shape: LayerShape) =>
  (shape.scope === "vertex" ? world.cellsX + 1 : world.cellsX) * shape.stride;

/** Number of rows a layer has. */
const rowCountOf = (world: WorldData, shape: LayerShape) =>
  shape.scope === "vertex" ? world.cellsZ + 1 : world.cellsZ;

/** A zero layer of a missing optional layer, for comparing what an edit created. */
const createLayerOf = (shape: LayerShape, length: number): LayerArray => {
  if (shape.type === "f32") return new Float32Array(length);
  if (shape.type === "u16") return new Uint16Array(length);
  return new Uint8Array(length);
};

/** Every layer an edit can touch; the props layers cover the used entries. */
const listTrackedLayers = (world: WorldData, terrain: TerrainEditState | null): TrackedLayer[] => [
  ...MAP_LAYERS.map(({ get, name }) => ({ get: () => get(world), name })),
  { get: () => world.normals, name: "normals" },
  ...(["heights", "splat", "waterSurface"] as const).map(key => ({
    get: () => terrain ? (terrain.base?.[key] ?? world[key]) : null,
    name: `terrain.base.${key}`
  })),
  ...TERRAIN_ARRAYS.map((key) => ({ get: () => terrain?.[key], name: `terrain.${key}` }))
];

const isStanding = (type: number | undefined) => type !== undefined && type !== PROP_REMOVED;

/** The props whose standing differs between the two sides of the type spans. */
const listPropChanges = (diff: WorldDiff, side: DiffSide, world: WorldData): PropChanges => {
  const other: DiffSide = side === "after" ? "before" : "after";
  const changes: PropChanges = { removed: [], restored: [] };
  const spans = diff.layers.find(({ name }) => name === "props.types")?.spans ?? [];
  for (const span of spans) {
    const length = Math.max(span.after.length, span.before.length);
    for (let offset = 0; offset < length; offset += 1) {
      const now = isStanding(span[side][offset]);
      if (now === isStanding(span[other][offset])) continue;
      (now ? changes.restored : changes.removed).push(span.start + offset);
    }
  }
  const changed = new Set<number>();
  for (const layer of diff.layers) {
    if (!layer.name.startsWith("props.") || layer.name === "props.types") continue;
    for (const span of layer.spans) {
      for (let offset = 0; offset < Math.min(span.after.length, span.before.length); offset++) {
        if (span.after[offset] !== span.before[offset]) changed.add(span.start + offset);
      }
    }
  }
  // Added/removed entries already have lifecycle notifications. A stable standing entry needs
  // both notifications so generated static instances are hidden and redrawn at the new transform.
  const lifecycle = new Set([...changes.removed, ...changes.restored]);
  for (const id of changed) {
    if (lifecycle.has(id) || id >= Math.min(diff.propCount.before, diff.propCount.after) ||
      !isStanding(world.props.types[id])) continue;
    changes.removed.push(id);
    changes.restored.push(id);
  }
  return changes;
};

/**
 * The world as it was when an edit began (reused buffers), compared after the edit: only what
 * changed is kept per undo step. A local `capture(scope)` keeps just the affected rows of the
 * layers an edit can derive locally; the same scope is used for the diff, so unchanged rows are
 * never examined. Layers whose changes cannot be bounded (whole-island distance fields, props)
 * keep the full copy and scan.
 */
export const createWorldSnapshot = (world: WorldData, terrain: TerrainEditState | null) => {
  const layers = listTrackedLayers(world, terrain);
  const captures = new Map<string, LayerCapture>();
  let metaCaptured = false;
  let propCount = world.props.count;
  let terrainMeta: TerrainMeta | null = null;
  let zones: MineZone[] = [];
  let scenario: WorldData["scenario"];
  let treeAges: WorldData["authoredTreeAges"];
  let stoneDeposits: WorldData["colonyStoneDeposits"];
  let environment: WorldData["environmentDefaults"];
  let groundPalette: WorldData["groundPalette"];
  let rivers: WorldData["authoredRivers"];
  let generatedRivers: WorldData["generatedRivers"];
  let featureIdentities: WorldData["generatedFeatureIdentities"];
  let waterfalls: WorldData["waterfalls"];

  const layerCapture = (name: string) => {
    let capture = captures.get(name);
    if (!capture) {
      capture = { buffer: null, full: undefined, patches: [] };
      captures.set(name, capture);
    }
    return capture;
  };

  /** Forgets the previous step but keeps its whole-layer buffers for reuse. */
  const reset = () => {
    for (const capture of captures.values()) {
      capture.full = undefined;
      capture.patches = [];
    }
    metaCaptured = false;
  };

  /** The small non-layer state (props, zones, terrain stamps, authored metadata). */
  const captureMeta = () => {
    if (metaCaptured) return;
    propCount = world.props.count;
    terrainMeta = terrain && copyTerrainMeta(terrain);
    zones = copyZones(world.mineZones);
    scenario = structuredClone(world.scenario);
    treeAges = structuredClone(world.authoredTreeAges);
    stoneDeposits = structuredClone(world.colonyStoneDeposits);
    environment = structuredClone(world.environmentDefaults);
    groundPalette = structuredClone(world.groundPalette);
    rivers = structuredClone(world.authoredRivers);
    generatedRivers = structuredClone(world.generatedRivers);
    featureIdentities = structuredClone(world.generatedFeatureIdentities);
    waterfalls = structuredClone(world.waterfalls);
    metaCaptured = true;
  };

  /** Copies the whole layer now (the original behavior, also the fallback for global layers). */
  const captureFull = (name: string, get: () => LayerArray | null | undefined) => {
    const capture = layerCapture(name);
    if (capture.full !== undefined) return;
    const current = get();
    if (!current) {
      capture.full = null;
      capture.patches = [];
      return;
    }
    const copy = copyLayer(capture.buffer ?? undefined, current);
    // A previous bounded capture of this step may already hold the before values of the rows
    // it recorded (the world is already edited there): restore those over the later copy.
    for (const patch of capture.patches) copy.set(patch.values, patch.start);
    capture.buffer = copy;
    capture.full = copy;
    capture.patches = [];
  };

  /** Grows the captured rows without re-reading rows already recorded before they changed. */
  const captureRows = (
    name: string,
    get: () => LayerArray | null | undefined,
    minRow: number,
    maxRow: number
  ) => {
    const shape = shapeOf(name);
    if (!shape || shape.scope === "prop") return captureFull(name, get);
    const capture = layerCapture(name);
    if (capture.full !== undefined) return;
    const rowLength = rowLengthOf(world, shape);
    const lastRow = rowCountOf(world, shape) - 1;
    const start = Math.max(0, minRow);
    const end = Math.min(lastRow, maxRow) + 1;
    if (start >= end) return;
    if (start === 0 && end === lastRow + 1) return captureFull(name, get);
    const current = get();
    const patchOf = (from: number, until: number): RowPatch => ({
      start: from * rowLength,
      values: current
        ? current.slice(from * rowLength, until * rowLength) as LayerArray
        : createLayerOf(shape, (until - from) * rowLength)
    });
    const patches = capture.patches;
    let next = start;
    for (const patch of [...patches].sort((first, second) => first.start - second.start)) {
      const patchFrom = Math.floor(patch.start / rowLength);
      const patchUntil = patchFrom + Math.floor(patch.values.length / rowLength);
      if (patchUntil <= next) continue;
      if (patchFrom >= end) break;
      if (patchFrom > next) patches.push(patchOf(next, patchFrom));
      next = Math.max(next, patchUntil);
    }
    if (next < end) patches.push(patchOf(next, end));
    patches.sort((first, second) => first.start - second.start);
    // Join adjacent captured row runs so one edit keeps one diff span run.
    for (let index = 1; index < patches.length;) {
      const previous = patches[index - 1]!;
      const patch = patches[index]!;
      if (previous.start + previous.values.length !== patch.start) {
        index += 1;
        continue;
      }
      const Constructor = previous.values.constructor as new (length: number) => LayerArray;
      const joined = new Constructor(previous.values.length + patch.values.length);
      joined.set(previous.values);
      joined.set(patch.values, previous.values.length);
      previous.values = joined;
      patches.splice(index, 1);
    }
  };

  /**
   * Captures the layers before an edit. Without a scope every tracked layer is copied (the
   * original behavior); with the edit's actual cells only the touched rows of local layers are
   * copied, while global layers stay whole.
   */
  const captureLayers = (scope?: WorldEditScope) => {
    for (const { get, name } of layers) {
      if (!scope) {
        captureFull(name, get);
        continue;
      }
      const shape = shapeOf(name);
      const global = GLOBAL_LAYERS.has(name) &&
        !(name === "coastDistance" && scope.waterChanged === false);
      if (!shape || shape.scope === "prop" || global) {
        captureFull(name, get);
        continue;
      }
      if (scope.cells.minX > scope.cells.maxX || scope.cells.minZ > scope.cells.maxZ) continue;
      const halo = ROW_HALO.get(name) ?? (shape.scope === "cell" ? 1 : 0);
      const vertexRows = shape.scope === "vertex" ? 1 : 0;
      captureRows(name, get, scope.cells.minZ - halo, scope.cells.maxZ + vertexRows + halo);
    }
  };

  /** A complete capture (the original snapshot API): reset, metadata and every layer. */
  const capture = (scope?: WorldEditScope) => {
    reset();
    captureMeta();
    captureLayers(scope);
  };

  const diffLayers = () =>
    layers.flatMap(({ get, name }): LayerChange[] => {
      const current = get();
      if (!current) return [];
      const capture = captures.get(name);
      if (!capture || (capture.full === undefined && capture.patches.length === 0)) return [];
      let spans: LayerSpan[] = [];
      if (capture.full !== undefined) {
        spans = findChangedSpans(capture.full ?? createZeroLayer(current), current);
      } else {
        for (const patch of capture.patches) {
          const after = current.slice(patch.start, patch.start + patch.values.length) as LayerArray;
          for (const span of findChangedSpans(patch.values, after)) {
            span.start += patch.start;
            spans.push(span);
          }
        }
      }
      return spans.length > 0 ? [{ name, spans }] : [];
    });

  const diffTerrain = (): Sides<TerrainMeta> | null => {
    if (!terrain || !terrainMeta || !isTerrainChanged(terrainMeta, terrain)) return null;
    return { after: copyTerrainMeta(terrain), before: terrainMeta };
  };

  /** What changed since the capture, or null when nothing did. */
  const diff = (): WorldDiff | null => {
    const changed = diffLayers();
    const terrainSides = diffTerrain();
    const zoneSides = isSameZones(zones, world.mineZones)
      ? null
      : { after: copyZones(world.mineZones), before: zones };
    const scenarioSides = JSON.stringify(scenario) === JSON.stringify(world.scenario) ? undefined
      : { before: scenario, after: structuredClone(world.scenario) };
    const treeAgeSides = JSON.stringify(treeAges) === JSON.stringify(world.authoredTreeAges) ? undefined
      : { before: treeAges, after: structuredClone(world.authoredTreeAges) };
    const stoneSides = JSON.stringify(stoneDeposits) === JSON.stringify(world.colonyStoneDeposits) ? undefined
      : { before: stoneDeposits, after: structuredClone(world.colonyStoneDeposits) };
    const environmentSides = JSON.stringify(environment) === JSON.stringify(world.environmentDefaults) ? undefined
      : { before: environment, after: structuredClone(world.environmentDefaults) };
    const paletteSides = JSON.stringify(groundPalette) === JSON.stringify(world.groundPalette) ? undefined
      : { before: groundPalette, after: structuredClone(world.groundPalette) };
    const riverSides = JSON.stringify(rivers) === JSON.stringify(world.authoredRivers) ? undefined
      : { before: rivers, after: structuredClone(world.authoredRivers) };
    const generatedRiverSides = JSON.stringify(generatedRivers) === JSON.stringify(world.generatedRivers) ? undefined
      : { before: generatedRivers, after: structuredClone(world.generatedRivers) };
    const featureIdentitySides = JSON.stringify(featureIdentities) === JSON.stringify(world.generatedFeatureIdentities)
      ? undefined : { before: featureIdentities, after: structuredClone(world.generatedFeatureIdentities) };
    const waterfallSides = JSON.stringify(waterfalls) === JSON.stringify(world.waterfalls) ? undefined
      : { before: waterfalls, after: structuredClone(world.waterfalls) };
    if (changed.length === 0 && !terrainSides && !zoneSides && !scenarioSides &&
      !stoneSides && !treeAgeSides && !environmentSides && !paletteSides && !riverSides && !generatedRiverSides && !featureIdentitySides && !waterfallSides) return null;
    const spanBytes = changed.flatMap(({ spans }) => spans.map(getSpanBytes));
    const bytes =
      spanBytes.reduce((sum, value) => sum + value, 0) +
      (terrainSides ? getTerrainMetaBytes(terrainSides.after) * 2 : 0) +
      (zoneSides ? getZonesBytes(zoneSides) : 0);
    return {
      bytes: bytes + JSON.stringify([stoneSides, scenarioSides, treeAgeSides, environmentSides, paletteSides, riverSides, generatedRiverSides,
        featureIdentitySides, waterfallSides]).length * 2,
      stoneDeposits: stoneSides,
      environment: environmentSides,
      groundPalette: paletteSides,
      treeAges: treeAgeSides,
      rivers: riverSides,
      generatedRivers: generatedRiverSides,
      featureIdentities: featureIdentitySides,
      waterfalls: waterfallSides,
      scenario: scenarioSides,
      layers: changed,
      propCount: { after: world.props.count, before: propCount },
      terrain: terrainSides,
      zones: zoneSides
    };
  };

  return { capture, captureLayers, captureMeta, diff, reset };
};

/**
 * Puts one side of a diff back into the world (undo: "before", redo: "after"): the props list
 * gets its length first, then every changed span is written in place (the layers keep their
 * arrays; entries changed since by play stay), the mine zone records and the terrain state
 * follow. The build revision moves on (the building spots overlay redraws). Returns the props
 * taken away or brought back.
 */
export const applyWorldDiff = (
  world: WorldData,
  terrain: TerrainEditState | null,
  diff: WorldDiff,
  side: DiffSide
): PropChanges => {
  const count = diff.propCount[side];
  if (world.props.count !== count) resizeProps(world.props, count);
  const layers = new Map(listTrackedLayers(world, terrain).map((layer) => [layer.name, layer]));
  for (const { name, spans } of diff.layers) {
    const target = layers.get(name)?.get();
    if (!target) continue;
    for (const span of spans) writeSpan(target, span, side);
  }
  if (diff.rivers) world.authoredRivers = structuredClone(diff.rivers[side]);
  if (diff.generatedRivers) world.generatedRivers = structuredClone(diff.generatedRivers[side]);
  if (diff.featureIdentities) world.generatedFeatureIdentities = structuredClone(diff.featureIdentities[side]);
  if (diff.waterfalls) world.waterfalls = structuredClone(diff.waterfalls[side]);
  if (diff.scenario) world.scenario = structuredClone(diff.scenario[side]);
  if (diff.treeAges) world.authoredTreeAges = structuredClone(diff.treeAges[side]);
  if (diff.stoneDeposits) world.colonyStoneDeposits = structuredClone(diff.stoneDeposits[side]);
  if (diff.environment) world.environmentDefaults = structuredClone(diff.environment[side]);
  if (diff.groundPalette) world.groundPalette = structuredClone(diff.groundPalette[side]);
  if (diff.zones) restoreZones(world, diff.zones[side]);
  if (terrain && diff.terrain) restoreTerrainMeta(terrain, diff.terrain[side]);
  // The cached light surface tracks layer spans through rebakes; a direct undo/redo span write
  // bypasses them, so the next bake must rebuild it from the restored heights and water.
  if (diff.layers.some((layer) => layer.name === "heights" || layer.name === "waterSurface"))
    clearTerrainLightCache(world);
  world.buildRevision = (world.buildRevision ?? 0) + 1;
  if (diff.layers.some(layer => ["heights", "waterDepth", "lakeWater"].includes(layer.name)))
    world.terrainRevision = (world.terrainRevision ?? 0) + 1;
  return listPropChanges(diff, side, world);
};

/** Whether the diff changed a layer (heights, water: the terrain path rebuilds). */
export const hasLayerChange = (diff: WorldDiff | null, name: string) =>
  diff?.layers.some((layer) => layer.name === name) ?? false;
