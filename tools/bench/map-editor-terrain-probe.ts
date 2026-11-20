import type { CellRegion } from "../../src/shared/world/grid-geometry";
import { sampleSmooth } from "../../src/shared/world/grid-geometry";
import type { WorldData } from "../../src/shared/world/world-data";
import { type ContourSampling, naturalContourPoints, naturalContourThresholds } from "./terrain-contour-candidates";

/**
 * In-page probe of the heavy terrain review (loaded through the dev server): world digests for
 * undo / save checks and the integrity counts of an edited region.
 */
const SPIKE = 1.6;
const HOLE_DEPTH = 0.3;
const PROP_DRIFT = 0.3;
const DEAD_PROP = 255;

const hashBytes = async (array: ArrayBufferView) => {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength).slice();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].slice(0, 8).map(value => value.toString(16).padStart(2, "0")).join("");
};

const liveProps = (world: WorldData, identityOnly = false) => {
  const { props } = world;
  const rows: number[] = [];
  for (let id = 0; id < props.count; id++) {
    if (props.types[id] === DEAD_PROP) continue;
    rows.push(id, props.types[id]!, props.form[id]!, props.phase[id]!, props.rotation[id]!, props.scale[id]!);
    if (!identityOnly) rows.push(props.x[id]!, props.y[id]!, props.z[id]!);
  }
  return Float64Array.from(rows);
};

/** Hashes of every layer the heavy tools edit; equal digests mean an exact restore. */
export const digestWorld = async (world: WorldData) => ({
  flow: await hashBytes(world.flow),
  heights: await hashBytes(world.heights),
  lake: await hashBytes(world.lakeWater ?? new Uint8Array(world.heights.length)),
  mineZone: await hashBytes(world.mineZone),
  ore: await hashBytes(world.oreAmount),
  finiteSources: JSON.stringify({ ore: world.mineZones, stone: world.colonyStoneDeposits ?? [],
    scenarioStone: world.scenario?.marbleDeposits ?? [] }),
  propIdentities: await hashBytes(liveProps(world, true)),
  props: await hashBytes(liveProps(world)),
  rivers: JSON.stringify([world.authoredRivers ?? [], world.generatedRivers ?? []]),
  splat: await hashBytes(world.splat),
  water: await hashBytes(world.waterSurface)
});

const clampRegion = (world: WorldData, region: CellRegion, margin: number): CellRegion => ({
  maxX: Math.min(world.cellsX - 1, region.maxX + margin),
  maxZ: Math.min(world.cellsZ - 1, region.maxZ + margin),
  minX: Math.max(1, region.minX - margin),
  minZ: Math.max(1, region.minZ - margin)
});

const countSpikesAndHoles = (world: WorldData, area: CellRegion) => {
  const stride = world.cellsX + 1, { heights, waterSurface } = world;
  const spikeExamples: { height: number; neighbours: number[]; waterDepth: number; x: number; z: number }[] = [];
  let spikes = 0, holes = 0, maxSpike = 0, nonFinite = 0;
  for (let z = area.minZ; z <= area.maxZ; z++)
    for (let x = area.minX; x <= area.maxX; x++) {
      const vertex = z * stride + x, height = heights[vertex]!;
      if (!Number.isFinite(height) || !Number.isFinite(waterSurface[vertex]!)) { nonFinite++; continue; }
      const around = (heights[vertex - 1]! + heights[vertex + 1]! + heights[vertex - stride]! +
        heights[vertex + stride]!) / 4;
      const spike = Math.abs(height - around);
      maxSpike = Math.max(maxSpike, spike);
      if (spike > SPIKE) {
        spikes++;
        if (spikeExamples.length < 8) spikeExamples.push({ height,
          neighbours: [heights[vertex - 1]!, heights[vertex + 1]!, heights[vertex - stride]!,
            heights[vertex + stride]!], waterDepth: world.waterDepth[vertex]!, x, z });
      }
      if (height < world.seaLevel - HOLE_DEPTH && waterSurface[vertex]! <= height + 0.01) holes++;
    }
  return { holes, maxSpike: Number(maxSpike.toFixed(2)), nonFinite, spikeExamples, spikes };
};

/** Integrity counts of a region: spikes, dry holes below the sea, non-finite values. */
export const inspectRegion = (world: WorldData, region: CellRegion) =>
  countSpikesAndHoles(world, clampRegion(world, region, 3));

/** Ground offset of every live prop in the region (for the before / after drift check). */
export const propOffsets = (world: WorldData, region: CellRegion) => {
  const area = clampRegion(world, region, 2), offsets: Record<number, number> = {};
  const { props } = world;
  for (let id = 0; id < props.count; id++) {
    const x = props.x[id]!, z = props.z[id]!;
    if (props.types[id] === DEAD_PROP || x < area.minX || x > area.maxX + 1 || z < area.minZ || z > area.maxZ + 1)
      continue;
    offsets[id] = props.y[id]! - sampleSmooth(world, world.heights, x, z);
  }
  return offsets;
};

/** Props that stayed in place but no longer sit at their former height above the ground. */
export const countDriftedProps = (world: WorldData, before: Record<number, number>) => {
  let drifted = 0;
  for (const [key, offset] of Object.entries(before)) {
    const id = Number(key);
    if (world.props.types[id] === DEAD_PROP) continue;
    const now = world.props.y[id]! - sampleSmooth(world, world.heights, world.props.x[id]!, world.props.z[id]!);
    if (Math.abs(now - offset) > PROP_DRIFT) drifted++;
  }
  return drifted;
};

/** Heights under roads and buildings (settlement clearance), which every heavy tool must keep. */
export const settlementGroundHash = (world: WorldData) => {
  const clearance = world.settlementGroundClearance;
  if (!clearance) return 0;
  let sum = 0;
  for (let cell = 0; cell < clearance.length; cell++) {
    if (!clearance[cell]) continue;
    const x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
    sum += world.heights[z * (world.cellsX + 1) + x]! * (1 + (cell % 7));
  }
  return Number(sum.toFixed(3));
};


const TRIAL_TRANSFORMS = [
  [1, 0, 1], [0, 1, 1], [0, 0, 1.05], [0, 0, .95], [-1, 0, 1], [0, -1, 1],
  [6, 4, 1.3], [3, 0, 1.15], [0, 0, 1.25], [0, 0, .85], [-4, 2, 1], [2, -3, 1]
] as const;

/**
 * Tries move / resize of natural relief contours on a detached copy: refusal counts by reason and
 * the first accepted contour + transform (so the browser run can apply exactly that one).
 */
export const findMovableContour = async (
  world: WorldData, avoid: { x: number; z: number },
  options: { maxContours?: number; stopOnAcceptance?: boolean;
    transforms?: readonly (readonly [number, number, number])[]; sampling?: ContourSampling; minimumRelief?: number } = {}
) => {
  const { extractTerrainComponent } = await import("../../src/shared/world/editing/terrain/terrain-component");
  const { transformGeneratedFeature } =
    await import("../../src/shared/world/editing/terrain/generated-feature-transform");
  const { createTerrainEditState } = await import("../../src/shared/world/editing/terrain/terrain-edit-state");
  let copy = structuredClone(world);
  const stride = world.cellsX + 1, reasons: Record<string, number> = {}, blockers: Record<string, number> = {};
  const seen = new Set<string>();
  const successes: { cells: number; maximumRelief: number; includeRivers: boolean; threshold: number;
    transform: number[]; x: number; z: number }[] = [];
  const maxContours = Math.max(1, Math.min(150, options.maxContours ?? 150));
  let tried = 0, trials = 0, acceptedContours = 0;
  const sampling = options.sampling ?? "grid";
  const points = naturalContourPoints(world, avoid, sampling);
  for (const { x, z } of points) {
    const height = world.heights[z * stride + x]!;
    for (const threshold of naturalContourThresholds(height, world.seaLevel, sampling)) {
      const component = extractTerrainComponent(copy, { x, z }, "relief", world.seaLevel + threshold);
      if (!component || component.truncated ||
        (sampling === "local-peaks" && component.cells.length > 512)) continue;
      const first = component.cells.reduce((minimum, cell) => Math.min(minimum, cell), Infinity);
      const identity = `${first}:${component.cells.length}:${threshold}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const maximumRelief = component.cells.reduce((peak, cell) => {
        const vertex = Math.floor(cell / world.cellsX) * stride + cell % world.cellsX;
        return Math.max(peak, ...[vertex, vertex + 1, vertex + stride, vertex + stride + 1]
          .map(index => world.heights[index]! - world.seaLevel - threshold));
      }, 0);
      if (maximumRelief < (options.minimumRelief ?? 0)) continue;
      tried++;
      let accepted = false;
      const own: Record<string, number> = {};
      for (const [offsetX, offsetZ, scale] of options.transforms ?? TRIAL_TRANSFORMS) for (const includeRivers of [false, true]) {
        trials++;
        try {
          transformGeneratedFeature(copy, createTerrainEditState(), component,
            { includeRivers, offsetX, offsetZ, scale });
          successes.push({ cells: component.cells.length, maximumRelief, includeRivers, threshold, transform: [offsetX, offsetZ, scale * 100], x: x + .5,
            z: z + .5 });
          if (options.stopOnAcceptance !== false)
            return { accepted: successes[0]!, acceptedContours: acceptedContours + 1, blockers, reasons, successes, tried, trials };
          accepted = true;
          copy = structuredClone(world);
        } catch (error) {
          const reason = `${includeRivers ? "rivers: " : ""}${(error as Error).message.slice(0, 60)}`;
          reasons[reason] = (reasons[reason] ?? 0) + 1;
          own[reason] = (own[reason] ?? 0) + 1;
        }
      }
      if (accepted) acceptedContours++;
      else {
        const blocker = Object.entries(own).sort((a, b) => b[1] - a[1])[0]![0];
        blockers[blocker] = (blockers[blocker] ?? 0) + 1;
      }
      if (tried >= maxContours)
        return { accepted: successes[0] ?? null, acceptedContours, blockers, reasons, successes, tried, trials };
    }
  }
  return { accepted: successes[0] ?? null, acceptedContours, blockers, reasons, successes, tried, trials };
};

/** Natural shore points where every coast operation previews a change; refusal counts by reason. */
export const findCoastTarget = async (world: WorldData, avoid: { x: number; z: number }) => {
  const { previewCoastReshape } = await import("../../src/shared/world/editing/terrain/coast-reshape");
  const { createTerrainEditState } = await import("../../src/shared/world/editing/terrain/terrain-edit-state");
  const stride = world.cellsX + 1, sea = world.seaLevel, reasons: Record<string, number> = {};
  const height = (x: number, z: number) => world.heights[z * stride + x]!;
  let tried = 0, shore: { x: number; z: number } | null = null;
  for (let z = 14; z < world.cellsZ - 14; z += 3) for (let x = 14; x < world.cellsX - 14; x += 3) {
    if (height(x, z) < sea + .2 || height(x, z) > sea + 1.5 || Math.hypot(x - avoid.x, z - avoid.z) < 30) continue;
    if (![[4, 0], [-4, 0], [0, 4], [0, -4]].some(([dx, dz]) => height(x + dx!, z + dz!) < sea - .5)) continue;
    tried++;
    const accepted = (["beach", "sea", "flatten"] as const).filter(mode => {
      try {
        const preview = previewCoastReshape(world, createTerrainEditState(),
          { mode, radius: 5, strength: .7, targetHeight: sea + 2, x: x + .5, z: z + .5 });
        if (preview.diff && preview.changed) return true;
        reasons[`${mode}: no change`] = (reasons[`${mode}: no change`] ?? 0) + 1;
      } catch (error) {
        const reason = `${mode}: ${(error as Error).message.slice(0, 50)}`;
        reasons[reason] = (reasons[reason] ?? 0) + 1;
      }
      return false;
    });
    if (accepted.length === 3 && !shore) shore = { x: x + .5, z: z + .5 };
    if (tried >= 200) break;
  }
  return { reasons, shore, tried };
};


const WATER_PLANTS = new Set([8, 9, 19]);

/** Land plants and trees (not rocks or water plants) standing in water inside the region. */
export const listWetLandPlants = (world: WorldData, region: CellRegion) => {
  const { props } = world, rows: string[] = [];
  for (let id = 0; id < props.count; id++) {
    const type = props.types[id]!, x = props.x[id]!, z = props.z[id]!;
    if (type === DEAD_PROP || type === 4 || type === 5 || WATER_PLANTS.has(type) || type === 20) continue;
    if (x < region.minX || x > region.maxX + 1 || z < region.minZ || z > region.maxZ + 1) continue;
    const depth = sampleSmooth(world, world.waterDepth, x, z);
    if (depth > .05) rows.push(`${type}@${x.toFixed(1)},${z.toFixed(1)}:${depth.toFixed(2)}`);
  }
  return rows;
};
