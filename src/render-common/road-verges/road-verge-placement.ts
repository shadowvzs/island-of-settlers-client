import type { RoadSegment } from "../../shared/settlement/road-types";
import type { WorldData } from "../../shared/world/world-data";
import { growsRoadVerge, ROAD_VERGE_BANDS, type RoadVergeBand, roadVergeWidening } from "./road-verge-bands";
import { vergePlantRadius, type VergeSpecies } from "./verge-plant-geometry";

export interface RoadVergePlacement {
  band: RoadVergeBand;
  kind: VergeSpecies;
  phase: number;
  /** Stable rank, uniform 0..1 inside every band, for nested projected-size thinning. */
  rank: number;
  scale: number;
  variant: number;
  x: number;
  yaw: number;
  z: number;
}

/** Candidate spacing along a road; ordinary road segments are half-cell (0.5) or diagonal steps. */
const STEP = .25;
const ORDER: readonly RoadVergeBand[] = ["A", "B", "C"];
/** Drift lattice (world units): plants vary gently about this long; no bare stretches (owner 2026-11-08). */
const DRIFT_CELL = 1.05;
/** Gentle density variation only: the verge stays continuous, never thins to a gap or clumps into a bed. */
const DRIFT_RANGE: readonly [number, number] = [.85, 1.15];
/** Share of the plants in a drift that take its dominant species; the rest follow the band mix. */
const DRIFT_DOMINANCE = .7;

const hash = (a: number, b: number, c: number) => {
  let value = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2246822519);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};

/** Rank plain of the R2 sequence: low discrepancy keeps every stretch of verge near its mean. */
const RANK_X = .7548776662466927;
const RANK_Z = .5698402909980532;
const RANK_SLOT = .6180339887498949;
/** Uniform 0..1 rank of a quarter-cell position, evenly spread over every short run along a road. */
const rankAt = (x: number, z: number, slot: number) => {
  const rank = x * RANK_X + z * RANK_Z + slot * RANK_SLOT;
  return rank - Math.floor(rank);
};

/** Band A: trample-tolerant rosettes and mats; B: short grass with daisies; C: taller herbs. */
const kindFor = (band: RoadVergeBand, pick: number): VergeSpecies => {
  if (band === "A") {
    if (pick < .3) return "clover";
    return pick < .6 ? "plantain" : "dandelion";
  }
  if (band === "B") return pick < .55 ? "grass" : "daisy";
  return pick < .5 ? "yarrow" : "daisy";
};

const fade = (value: number) => value * value * (3 - 2 * value);
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;

/** Smooth value noise (0..1) on the drift lattice, keyed by world position only. */
const driftNoise = (x: number, z: number, salt: number) => {
  const gridX = x / DRIFT_CELL, gridZ = z / DRIFT_CELL, cellX = Math.floor(gridX), cellZ = Math.floor(gridZ);
  const fadeX = fade(gridX - cellX), fadeZ = fade(gridZ - cellZ);
  const at = (offsetX: number, offsetZ: number) => hash(cellX + offsetX, cellZ + offsetZ, salt);
  return mix(mix(at(0, 0), at(1, 0), fadeX), mix(at(0, 1), at(1, 1), fadeX), fadeZ);
};

/** Smooth drift factor in [.85, 1.15]: no threshold, so a road side is never bare and never over-dense. */
const driftDensity = (x: number, z: number) =>
  mix(DRIFT_RANGE[0], DRIFT_RANGE[1], fade(driftNoise(x, z, 71)));

/** A drift's dominant pick (nearest lattice cell): flowering drifts and greener drifts alternate. */
const driftPick = (x: number, z: number) => hash(Math.round(x / DRIFT_CELL), Math.round(z / DRIFT_CELL), 97);

const segmentKey = (segment: RoadSegment) => [segment.start, segment.end]
  .map(point => `${point.x}:${point.z}`).sort().join("/");

/** Accepts a plant if it can lie free; `reach` is its measured horizontal radius at its scale. */
export type RoadVergeFreeTest = (x: number, z: number, band: RoadVergeBand, reach: number) => boolean;

interface Candidate {
  band: RoadVergeBand;
  baseX: number;
  baseZ: number;
  nx: number;
  nz: number;
  side: -1 | 1;
  /** Extra outward shift of the bands where the road ribbon is wider than a stone road. */
  widening: number;
}

/**
 * One hashed candidate beside a road point. Its whole measured crown stays outside the band's
 * inner edge, so verge cover starts at the two-lane cart half-width, never inside the lanes.
 */
const candidateAt = ({ band, baseX, baseZ, nx, nz, side, widening }: Candidate,
  world: Pick<WorldData, "cellsX" | "cellsZ">, isFree: RoadVergeFreeTest): RoadVergePlacement | undefined => {
  const tuning = ROAD_VERGE_BANDS[band], from = tuning.from + widening;
  const innerX = baseX + nx * side * from, innerZ = baseZ + nz * side * from;
  const cellX = Math.floor(innerX * 4), cellZ = Math.floor(innerZ * 4);
  const slot = (band.charCodeAt(0) - 64) * 2 + (side > 0 ? 1 : 0);
  const density = Math.min(1, tuning.density * driftDensity(innerX, innerZ));
  const rank = rankAt(innerX * 4, innerZ * 4, slot);
  if (rank >= density) return undefined;
  const dominant = hash(cellX + 61, cellZ + 67, slot) < DRIFT_DOMINANCE;
  const kind = kindFor(band, dominant ? driftPick(innerX, innerZ) : hash(cellX + 53, cellZ + 59, slot));
  const scale = .8 + hash(cellX + 23, cellZ + 29, slot) * .4;
  const reach = vergePlantRadius(kind) * scale;
  const offset = Math.max(from + hash(cellZ, cellX, slot + 7) * (tuning.to - tuning.from), from + reach);
  const x = baseX + nx * side * offset, z = baseZ + nz * side * offset;
  if (x < reach || z < reach || x >= world.cellsX - reach || z >= world.cellsZ - reach) return undefined;
  if (!isFree(x, z, band, reach)) return undefined;
  return { band, kind, phase: hash(cellX + 11, cellZ + 17, slot) * Math.PI * 2, rank: rank / density, scale,
    variant: Math.floor(hash(cellX + 31, cellZ + 37, slot) * 3), x,
    yaw: hash(cellX + 41, cellZ + 43, slot) * Math.PI * 2, z };
};

/**
 * Pure, worker-safe verge placement from world coordinates only. Splitting, merging or reloading
 * a road reproduces the same plants because every candidate is keyed by its world position.
 */
export const createRoadVergePlacements = (
  segments: readonly RoadSegment[],
  world: Pick<WorldData, "cellsX" | "cellsZ">,
  isFree: RoadVergeFreeTest
): RoadVergePlacement[] => {
  const unique = new Map<string, RoadSegment>();
  for (const segment of segments) if (growsRoadVerge(segment)) unique.set(segmentKey(segment), segment);
  const ordered = [...unique.values()].sort((first, second) =>
    segmentKey(first).localeCompare(segmentKey(second)));
  const occupied = new Map<string, RoadVergePlacement>();
  /**
   * Junctions and parallel roads never stack plants: one plant per band and quarter cell, lowest
   * position wins. Plants of neighbouring bands may share a cell, so drifts close up into clumps.
   */
  const keep = (candidate: RoadVergePlacement | undefined) => {
    if (!candidate) return;
    const key = `${candidate.band}${Math.floor(candidate.x * 4)},${Math.floor(candidate.z * 4)}`;
    const existing = occupied.get(key);
    if (!existing || `${candidate.x}:${candidate.z}` < `${existing.x}:${existing.z}`) occupied.set(key, candidate);
  };
  for (const segment of ordered) {
    const dx = segment.end.x - segment.start.x, dz = segment.end.z - segment.start.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    const ux = dx / length, uz = dz / length, nx = -uz, nz = ux;
    for (let along = STEP; along <= length; along += STEP) for (const side of [-1, 1] as const) {
      const baseX = segment.start.x + ux * along, baseZ = segment.start.z + uz * along;
      const widening = roadVergeWidening(segment, along / length);
      for (const band of ORDER) keep(candidateAt({ band, baseX, baseZ, nx, nz, side, widening }, world, isFree));
    }
  }
  return [...occupied.values()].sort((first, second) => first.x - second.x || first.z - second.z ||
    first.band.localeCompare(second.band));
};
