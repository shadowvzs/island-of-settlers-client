import { inspectLocalNavigation, type NavigationInspectionCell } from "../../../settlement/settlement-navigation-inspection";
import { type CellRegion,getCircleRegion, sampleSmooth } from "../../grid-geometry";
import { smoothstep } from "../../noise";
import { PROP, PROP_REMOVED, type WorldData } from "../../world-data";
import { isAquaticDecoration } from "../aquatic-decoration";
import { applyWorldDiff, createWorldSnapshot, type WorldDiff } from "../history/world-diff";
import { removePropsAt, STONE_PROPS } from "../prop-removal";
import { assertSeedRestoreBoundary } from "./seed-restore-boundary";
import { seedRestoreProtectedVertices } from "./seed-restore-protection";
import { getTerrainApplyRegion,refreshEditedTerrain } from "./terrain-apply";
import { applyTerrainBrush, terrainBrushBounds, type TerrainBrushStroke } from "./terrain-brush";
import type { TerrainEditState } from "./terrain-edit-state";

interface CoastNavigationSample extends NavigationInspectionCell { y: number }
export interface CoastReshapePreview {
  sourceRevision: string;
  diff: WorldDiff | null;
  state: TerrainEditState;
  cells: CellRegion;
  /** The larger region the undo capture must keep (baked stamp base arrays included). */
  historyCells: CellRegion;
  removed: number[];
  changed: number;
  protected: number;
  before: Record<"walking" | "sea" | "oceanTurning", CoastNavigationSample[]>;
  after: Record<"walking" | "sea" | "oceanTurning", CoastNavigationSample[]>;
}

const coastRevision = (world: WorldData, state: TerrainEditState) => [world.seed, world.cellsX, world.cellsZ,
  world.buildRevision ?? 0, world.terrainRevision ?? 0, world.props.count, state.nextId, state.stamps.length].join("/");

const navigation = (world: WorldData, centre: { x: number; z: number }) => {
  const result = {} as CoastReshapePreview["before"];
  for (const layer of ["walking", "sea", "oceanTurning"] as const)
    result[layer] = inspectLocalNavigation(world, centre, layer).map(cell => ({ ...cell,
      y: Math.max(sampleSmooth(world, world.heights, cell.x, cell.z),
        sampleSmooth(world, world.waterSurface, cell.x, cell.z)) + .12 }));
  return result;
};

/** Detached native brush + rule inspection. Preview never writes live heights, props, paints or state. */
/** A join to kept ground may reach this height step, or the kept step plus the slack when it was steeper. */
const STEP_LIMIT = .7;
const STEP_SLACK = .04;
/** Pulling a vertex back can expose its neighbour to kept ground; a few passes settle the edge. */
const BOUNDARY_PASSES = 4;

const isVertexChanged = (world: WorldData, draft: WorldData, vertex: number) =>
  draft.heights[vertex] !== world.heights[vertex] || draft.waterSurface[vertex] !== world.waterSurface[vertex];

/**
 * Pulls changed vertices back towards their old height where they meet kept ground (protected rocks,
 * the brush edge) more steeply than the boundary rule allows: the stroke tapers there instead of
 * being refused as a whole.
 */
const limitBoundarySteps = (world: WorldData, draft: WorldData, base: Float32Array, cells: CellRegion) => {
  const stride = world.cellsX + 1;
  for (let z = cells.minZ; z <= cells.maxZ + 1; z++) for (let x = cells.minX; x <= cells.maxX + 1; x++) {
    const vertex = z * stride + x;
    if (draft.heights[vertex] === world.heights[vertex]) continue;
    let low = -Infinity, high = Infinity;
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const nx = x + dx, nz = z + dz, neighbour = nz * stride + nx;
      const outside = nx < 0 || nz < 0 || nx > world.cellsX || nz > world.cellsZ;
      if (outside || isVertexChanged(world, draft, neighbour)) continue;
      const kept = world.heights[neighbour]!;
      const limit = Math.max(STEP_LIMIT, Math.abs(world.heights[vertex]! - kept) + STEP_SLACK);
      low = Math.max(low, kept - limit); high = Math.min(high, kept + limit);
    }
    const height = Math.min(high, Math.max(low, draft.heights[vertex]!));
    if (height === draft.heights[vertex]) continue;
    draft.heights[vertex] = base[vertex] = height;
    draft.waterDepth[vertex] = Math.max(0, draft.waterSurface[vertex]! - height);
  }
};

const isWaterPlant = (type: number) =>
  isAquaticDecoration(type) || type === PROP.reeds || type === PROP.cattail || type === PROP.waterLily;

/** Water this deep over a land plant's foot drowns it: no bush or palm stands in the new sea. */
const FLOODED_DEPTH = .05;

/** Plants and trees the tapered sea now covers (kept rocks stay): they would stand in the water. */
export const listFloodedPlants = (world: WorldData, draft: WorldData, reach: number,
  brush: Pick<TerrainBrushStroke, "x" | "z">) => {
  const flooded: number[] = [], { props } = world;
  for (let id = 0; id < props.count; id++) {
    const type = props.types[id]!, x = props.x[id]!, z = props.z[id]!;
    if (type === PROP_REMOVED || draft.props.types[id] === PROP_REMOVED || STONE_PROPS.has(type) ||
      isWaterPlant(type) || Math.hypot(x - brush.x, z - brush.z) > reach) continue;
    if (sampleSmooth(world, world.waterDepth, x, z) <= FLOODED_DEPTH &&
      sampleSmooth(draft, draft.waterDepth, x, z) > FLOODED_DEPTH) flooded.push(id);
  }
  return flooded;
};
/** Rivers, lakes and their flow keep their own water level: a coast operation shapes only the sea. */
const protectFreshWater = (world: WorldData, cells: CellRegion, protectedVertices: Set<number>) => {
  const stride = world.cellsX + 1;
  for (let z = cells.minZ; z <= cells.maxZ + 1; z++) for (let x = cells.minX; x <= cells.maxX + 1; x++) {
    const vertex = z * stride + x;
    const fresh = world.waterDepth[vertex]! > .01 && world.waterSurface[vertex]! > world.seaLevel + .05;
    if (fresh || world.flow[vertex * 2] || world.flow[vertex * 2 + 1]) protectedVertices.add(vertex);
  }
};

/** Vertices over which a coast change fades out towards protected ground (rocks, roads, plots). */
const PROTECTED_TAPER = 10;

/**
 * Fade of the coast change per vertex: none at protected ground, full from PROTECTED_TAPER vertices
 * away, so the reshaped shore meets kept rocks and plots in a slope instead of a step.
 */
const createProtectedTaper = (world: WorldData, protectedVertices: ReadonlySet<number>) => {
  const stride = world.cellsX + 1;
  return (x: number, z: number) => {
    let nearest = PROTECTED_TAPER;
    for (let dz = -PROTECTED_TAPER + 1; dz < PROTECTED_TAPER; dz++)
      for (let dx = -PROTECTED_TAPER + 1; dx < PROTECTED_TAPER; dx++) {
        const px = x + dx, pz = z + dz;
        if (px < 0 || pz < 0 || px > world.cellsX || pz > world.cellsZ) continue;
        if (protectedVertices.has(pz * stride + px)) nearest = Math.min(nearest, Math.hypot(dx, dz));
      }
    return smoothstep(0, PROTECTED_TAPER, nearest);
  };
};

export const previewCoastReshape = (world: WorldData, state: TerrainEditState, brush: TerrainBrushStroke
): CoastReshapePreview => {
  if (![brush.x, brush.z, brush.radius, brush.strength ?? 1].every(Number.isFinite) ||
    brush.radius < 2 || brush.radius > 12 || (brush.strength ?? 1) <= 0 || (brush.strength ?? 1) > 1 ||
    !["beach", "sea", "flatten"].includes(brush.mode ?? "") ||
    brush.x < 0 || brush.z < 0 || brush.x >= world.cellsX || brush.z >= world.cellsZ)
    throw new Error("Choose a bounded 2–12-tile coast brush and an in-map centre.");
  const { cells, reach } = terrainBrushBounds(world, brush);
  if ((cells.maxX - cells.minX + 2) * (cells.maxZ - cells.minZ + 2) > 8192)
    throw new Error("The native slope transition exceeds the 8,192-vertex preview budget. Choose a gentler shore.");
  const protectedVertices = seedRestoreProtectedVertices(world, state, cells), stride = world.cellsX + 1;
  for (let id = 0; id < world.props.count; id++) if (STONE_PROPS.has(world.props.types[id]!)) {
    const x = world.props.x[id]!, z = world.props.z[id]!;
    if (Math.hypot(x - brush.x, z - brush.z) > reach + 4) continue;
    const area = getCircleRegion(world, x, z, 3);
    for (let pz = area.minZ; pz <= area.maxZ + 1; pz++) for (let px = area.minX; px <= area.maxX + 1; px++)
      protectedVertices.add(pz * stride + px);
  }
  protectFreshWater(world, cells, protectedVertices);
  const draft = structuredClone(world), nextState = structuredClone(state);
  nextState.base ??= { heights: draft.heights.slice(), splat: draft.splat.slice(), waterSurface: draft.waterSurface.slice() };
  nextState.rise ??= new Float32Array(draft.heights.length);
  nextState.ring ??= new Float32Array(draft.heights.length);
  nextState.lake ??= new Uint8Array(draft.heights.length);
  draft.lakeWater ??= new Uint8Array(draft.heights.length);
  const historyCells = getTerrainApplyRegion(draft, nextState, [], [{ ...brush, protectCoast: false }]);
  const snapshot = createWorldSnapshot(draft, null);
  snapshot.capture({ cells: historyCells, waterChanged: true });
  const result = applyTerrainBrush(draft, nextState, { ...brush, protectCoast: false },
    (x, z) => !protectedVertices.has(z * stride + x), createProtectedTaper(world, protectedVertices));
  for (let pass = 0; pass < BOUNDARY_PASSES; pass++) limitBoundarySteps(world, draft, nextState.base.heights, cells);
  const flooded = listFloodedPlants(world, draft, reach, brush);
  removePropsAt(draft, flooded);
  const removed = [...result.removed, ...flooded];
  // A coast operation is not an implicit repaint; keep even deliberately painted shore materials.
  draft.splat.set(world.splat);
  nextState.base.splat.set(state.base?.splat ?? world.splat);
  const changed: number[] = [];
  for (let z = cells.minZ; z <= cells.maxZ + 1; z++) for (let x = cells.minX; x <= cells.maxX + 1; x++) {
    const vertex = z * stride + x;
    if (draft.heights[vertex] !== world.heights[vertex] || draft.waterSurface[vertex] !== world.waterSurface[vertex])
      changed.push(vertex);
  }
  try {
    assertSeedRestoreBoundary(world, changed, { heights: draft.heights, waterSurface: draft.waterSurface,
      flow: draft.flow, lakeWater: draft.lakeWater });
  } catch {
    throw new Error("Coast reshape would create an unsafe join at protected ground. " +
      "Smooth the boundary or choose another location; no terrain was changed.");
  }
  refreshEditedTerrain(draft, cells, result.waterChanged);
  return { sourceRevision: coastRevision(world, state), diff: snapshot.diff(), state: nextState,
    cells, historyCells, removed, changed: changed.length,
    protected: protectedVertices.size, before: navigation(world, brush), after: navigation(draft, brush) };
};

/** Caller guards revisions and records this real mutation in the existing editor history. */
export const commitCoastReshape = (world: WorldData, state: TerrainEditState, preview: CoastReshapePreview) => {
  if (coastRevision(world, state) !== preview.sourceRevision)
    throw new Error("Map or authored terrain changed after the coast preview; preview again before applying.");
  if (!preview.diff || !preview.changed) return { removed: [], restored: [] };
  const changed = applyWorldDiff(world, null, preview.diff, "after");
  Object.assign(state, structuredClone(preview.state));
  return changed;
};
