import { DMath } from "../../math/deterministic-math";
import { createFbm, type Noise2, smoothstep } from "../noise";
import type { IslandSite } from "./archipelago-rules";

/**
 * COAST-NATURAL (owner 2026-11-09): the angular coast profile (M06) reads natural on small islands
 * but leaves large ones as rounded, half-circle-like blobs. Larger islands get extra gulfs, bays and
 * coves whose size follows the island: gulfs and bays scale with the radius, coves keep a fixed cell
 * size, so a longer coast holds more of them. Islands at or below COAST_DETAIL_MIN_RADIUS keep their
 * coast unchanged.
 */
const COAST_DETAIL_MIN_RADIUS = 40;
const COAST_DETAIL_FULL_RADIUS = 80;
/** One or two wide gulfs set the large-scale silhouette; peninsulas remain between them. */
const GULF_FREQUENCY = .8;
const GULF_DEPTH_SHARE = .3;
const GULF_START = .05;
const GULF_FULL = .65;
/** Bays: noise units per radian around the coast and maximum depth as a share of the radius. */
const BAY_FREQUENCY = 1.7;
const BAY_DEPTH_SHARE = .18;
const BAY_START = -.2;
const BAY_FULL = .6;
const COVE_WAVELENGTH = 22;
const COVE_DEPTH = 6;
const COVE_START = 0;
const COVE_FULL = .7;
/**
 * Rounding along the coast (cells of arc, three box passes): bay heads become rounded coves and the
 * points between neighbouring bays become blunt headlands instead of needles.
 */
const ROUNDING_CELLS = 7;
/** Rounding grows with the island so large gulfs get wide, curved mouths instead of chords. */
const ROUNDING_SHARE = .1;
const ROUNDING_PASSES = 3;
/**
 * Angular warp per unit of (distance - radius) / radius: bays bend as they reach inland instead of
 * running straight towards the centre. Kept small, so every ray still crosses the coast once (no
 * detached islets, no landlocked lagoons).
 */
const BEND_FREQUENCY = 1.3;
const BEND = .4;
/** Beyond the envelope the extra indentation fades out so the sea floor stays continuous. */
const OFFSHORE_FADE_START = 6;
export const COAST_DETAIL_REACH = 30;
/**
 * The flank slope is measured at the coast; deep inland (near the centre) a per-radian slope would
 * blow up, so the arc length is taken at no less than half the radius there.
 */
const FLANK_MIN_RADIUS_SHARE = .5;
const NOISE_SEED_SCALE = 1_000_000;
const MIN_SAMPLES = 256;

interface CoastDetailProfile {
  /** Rounded M06 indent share, detail indentation (cells), its change per radian and the bend. */
  base: Float32Array;
  bend: Float32Array;
  indent: Float32Array;
  slope: Float32Array;
}
/**
 * The island layout's limits per coast angle, owned by archipelago-rules: the M06 indent share, the
 * largest detail indent that keeps the reserved ground clear, and the harbour shelter (0..1).
 */
export interface CoastDetailBounds {
  baseShare(angle: number): number;
  limit(angle: number): number;
  shelter(angle: number): number;
}
const profiles = new Map<string, CoastDetailProfile>();
const MAX_CACHED_PROFILES = 64;

/** 0 for small islands, rising to 1 at COAST_DETAIL_FULL_RADIUS. */
export const coastDetailStrength = (radius: number) =>
  smoothstep(COAST_DETAIL_MIN_RADIUS, COAST_DETAIL_FULL_RADIUS, radius);

/** A periodic noise sample around the coast at `frequency` noise units per radian. */
const aroundCoast = (noise: Noise2, angle: number, frequency: number) =>
  noise(DMath.cos(angle) * frequency, DMath.sin(angle) * frequency);

/** Circular running-sum box filter in place. */
const blurCircular = (values: Float32Array, radius: number) => {
  const length = values.length, copy = values.slice(), width = radius * 2 + 1;
  const at = (index: number) => copy[((index % length) + length) % length]!;
  let sum = 0;
  for (let offset = -radius; offset <= radius; offset++) sum += at(offset);
  for (let index = 0; index < length; index++) {
    values[index] = sum / width;
    sum += at(index + radius + 1) - at(index - radius);
  }
};

/** Raw gulf/bay/cove indentation (cells) at one angle, before rounding. */
const rawIndent = (site: IslandSite, noises: Record<"bay" | "cove" | "gulf", Noise2>, angle: number) => {
  const gulf = smoothstep(GULF_START, GULF_FULL, aroundCoast(noises.gulf, angle, GULF_FREQUENCY));
  const bay = smoothstep(BAY_START, BAY_FULL, aroundCoast(noises.bay, angle, BAY_FREQUENCY));
  const cove = smoothstep(COVE_START, COVE_FULL, aroundCoast(noises.cove, angle, site.radius / COVE_WAVELENGTH));
  return Math.max(gulf * GULF_DEPTH_SHARE, bay * BAY_DEPTH_SHARE) * site.radius + cove * COVE_DEPTH;
};

/** Central difference per radian of a circular table. */
const angularSlope = (values: Float32Array) => {
  const samples = values.length, slope = new Float32Array(samples), step = 2 * Math.PI / samples;
  for (let index = 0; index < samples; index++)
    slope[index] = (values[(index + 1) % samples]! - values[(index + samples - 1) % samples]!) / (2 * step);
  return slope;
};

/**
 * Seeded from the site phase like the angular profile; offsets keep the four fields independent.
 * The limits act on the angular tables before the rounding blur only, so the coast never follows a
 * reserved-ground box or a shelter edge in straight lines (the blur can spend a few cells of the
 * reserved-ground clearance, never more than the indent it spreads).
 */
const createProfile = (site: IslandSite, bounds: CoastDetailBounds): CoastDetailProfile => {
  const seed = Math.floor(site.phase * NOISE_SEED_SCALE);
  const noises = {
    bay: createFbm(seed + 1, { octaves: 3 }), bend: createFbm(seed + 2, { octaves: 2 }),
    cove: createFbm(seed + 3, { octaves: 2 }), gulf: createFbm(seed + 4, { octaves: 2 })
  };
  // About one sample per coast cell, so the rounding radius is measured in cells of arc.
  const samples = Math.max(MIN_SAMPLES, Math.ceil(2 * Math.PI * site.radius));
  const indent = new Float32Array(samples), bend = new Float32Array(samples);
  const base = new Float32Array(samples), limit = new Float32Array(samples);
  for (let index = 0; index < samples; index++) {
    const angle = index / samples * 2 * Math.PI - Math.PI;
    limit[index] = bounds.limit(angle);
    indent[index] = Math.min(limit[index]!, rawIndent(site, noises, angle) * (1 - bounds.shelter(angle)));
    base[index] = bounds.baseShare(angle);
    bend[index] = aroundCoast(noises.bend, angle, BEND_FREQUENCY);
  }
  const rounding = Math.max(ROUNDING_CELLS, Math.round(site.radius * ROUNDING_SHARE));
  for (let pass = 0; pass < ROUNDING_PASSES; pass++) {
    blurCircular(indent, rounding);
    blurCircular(base, ROUNDING_CELLS);
  }
  return { base, bend, indent, slope: angularSlope(indent) };
};

const getProfile = (site: IslandSite, bounds: CoastDetailBounds) => {
  const key = `${site.phase}:${site.radius}:${site.spaceWidth}:${site.spaceDepth}`;
  let profile = profiles.get(key);
  if (profile) return profile;
  if (profiles.size >= MAX_CACHED_PROFILES) profiles.clear();
  profile = createProfile(site, bounds);
  profiles.set(key, profile);
  return profile;
};

/** Linear interpolation in a circular angle table whose first sample sits at -PI. */
const sampleAngle = (table: Float32Array, angle: number) => {
  const position = ((angle + Math.PI) / (2 * Math.PI)) * table.length;
  const lower = Math.floor(position), weight = position - lower;
  const first = ((lower % table.length) + table.length) % table.length;
  return table[first]! + (table[(first + 1) % table.length]! - table[first]!) * weight;
};

/** Detail profile sample at `angle`, `distance` cells from the island centre (bend applied). */
const sampleDetail = (site: IslandSite, angle: number, distance: number, bounds: CoastDetailBounds,
  table: "indent" | "slope") => {
  const strength = coastDetailStrength(site.radius);
  if (strength <= 0 || distance > site.radius + COAST_DETAIL_REACH) return 0;
  const profile = getProfile(site, bounds);
  const bent = angle + sampleAngle(profile.bend, angle) * BEND * (distance - site.radius) / site.radius;
  const offshore = 1 - smoothstep(site.radius + OFFSHORE_FADE_START, site.radius + COAST_DETAIL_REACH, distance);
  return strength * offshore * sampleAngle(profile[table], bent);
};

/**
 * Extra coast indentation (cells, >= 0) at `angle` and `distance` cells from the island centre. Only
 * indents, so the coast never leaves the packed envelope and its ship channels stay as wide.
 */
export const coastDetailIndent = (site: IslandSite, angle: number, distance: number, bounds: CoastDetailBounds) =>
  sampleDetail(site, angle, distance, bounds, "indent");

/**
 * Change of that indentation per cell walked along the coast. A bay flank cuts the radial
 * shore distance at an angle; dividing by sqrt(1 + slope^2) turns it back into a distance to the
 * shore, so bay flanks keep the ordinary beach slope instead of a steep cut.
 */
export const coastDetailFlankSlope = (site: IslandSite, angle: number, distance: number,
  bounds: CoastDetailBounds) =>
  sampleDetail(site, angle, distance, bounds, "slope") / Math.max(distance, site.radius * FLANK_MIN_RADIUS_SHARE);

/**
 * The M06 indent share, rounded like the detail on large islands (its clamp left sharp corners there);
 * small islands keep the raw share.
 */
export const roundedCoastShare = (site: IslandSite, angle: number, bounds: CoastDetailBounds) => {
  const strength = coastDetailStrength(site.radius);
  const raw = bounds.baseShare(angle);
  if (strength <= 0) return raw;
  return raw + (sampleAngle(getProfile(site, bounds).base, angle) - raw) * strength;
};
