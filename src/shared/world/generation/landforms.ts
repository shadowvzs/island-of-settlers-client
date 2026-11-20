import { distanceToSegmentXZ } from "../../settlement/settlement-geometry";
import { createRandom, deriveSeed, pickWeighted, type Random, randomBetween } from "../rng";

export const LANDFORMS = ["island", "archipelago", "peninsula"] as const;

export type Landform = (typeof LANDFORMS)[number];

/** How often each landform comes up for a random seed (same order as LANDFORMS). */
const LANDFORM_WEIGHTS = [0.4, 0.35, 0.25];

/**
 * Map border the land continues past: only the far borders (x = 0 or z = 0), whose cut faces
 * away from the iso camera, so the end of the land reads as the map edge, not as a wall.
 */
type OpenSide = "x0" | "z0";

export interface LandformLayout {
  kind: Landform;
  openSide: OpenSide | null;
  /**
   * Macro land value at normalised (and already warped) map coordinates -1..1: > 0 is land,
   * rising about 1.2 per unit inland. Coast detail is added on top in cells.
   */
  shape: (u: number, v: number) => number;
}

/** Land rise per normalised unit of the single island (the tuned 128 x 128 slope). */
export const ISLAND_SLOPE = 1.22;

interface Blob {
  radius: number;
  u: number;
  v: number;
}

export const isLandform = (value: unknown): value is Landform =>
  LANDFORMS.some((landform) => landform === value);

/** The landform of a seed (deterministic); the default seed 1234 is a single island. */
export const chooseLandform = (seed: number): Landform => {
  const random = createRandom(deriveSeed(seed, "landform"));
  return LANDFORMS[pickWeighted(LANDFORM_WEIGHTS, random)] ?? "island";
};

/** One big island, slightly oval and turned, a little off centre. */
const createIslandShape = (random: Random) => {
  const aspect = randomBetween(random, 0.85, 1.15);
  const angle = random() * Math.PI;
  const centre = { u: randomBetween(random, -0.06, 0.06), v: randomBetween(random, -0.06, 0.06) };
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return (u: number, v: number) => {
    const du = u - centre.u;
    const dv = v - centre.v;
    const along = (du * cos + dv * sin) / aspect;
    const across = (dv * cos - du * sin) * aspect;
    return 1 - Math.hypot(along, across) * ISLAND_SLOPE;
  };
};

const MAIN_RADIUS = 0.6;
/** Land value at the main island's centre (the single island reaches 1). */
const MAIN_PEAK = 0.82;
const SATELLITE_SLOPE = 2.6;
const SATELLITE_GAP = 0.09;
const MAP_MARGIN = 0.9;

const fitsSatellite = (blob: Blob, main: Blob, others: Blob[]) => {
  if (Math.max(Math.abs(blob.u), Math.abs(blob.v)) + blob.radius > MAP_MARGIN) return false;
  const fromMain = Math.hypot(blob.u - main.u, blob.v - main.v);
  if (fromMain < main.radius + blob.radius + SATELLITE_GAP) return false;
  return others.every(
    (other) =>
      Math.hypot(blob.u - other.u, blob.v - other.v) > blob.radius + other.radius + SATELLITE_GAP
  );
};

/** Smaller islands in the sea ring around the main island, apart from it and each other. */
const placeSatellites = (random: Random, main: Blob) => {
  const satellites: Blob[] = [];
  const wanted = 4 + Math.floor(random() * 4);
  for (let attempt = 0; attempt < 60 && satellites.length < wanted; attempt += 1) {
    const radius = randomBetween(random, 0.09, 0.2);
    const angle = random() * Math.PI * 2;
    const distance = main.radius + radius + randomBetween(random, SATELLITE_GAP, 0.3);
    const blob = {
      radius,
      u: main.u + Math.cos(angle) * distance,
      v: main.v + Math.sin(angle) * distance
    };
    if (fitsSatellite(blob, main, satellites)) satellites.push(blob);
  }
  return satellites;
};

const getBlobValue = (blob: Blob, u: number, v: number, slope: number) =>
  (blob.radius - Math.hypot(u - blob.u, v - blob.v)) * slope;

/** A main island off centre with 4-7 satellite islands around it. */
const createArchipelagoShape = (random: Random) => {
  const main = {
    radius: MAIN_RADIUS * randomBetween(random, 0.9, 1.05),
    u: randomBetween(random, -0.18, 0.18),
    v: randomBetween(random, -0.18, 0.18)
  };
  const satellites = placeSatellites(random, main);
  const mainSlope = (ISLAND_SLOPE * MAIN_PEAK) / main.radius;
  return (u: number, v: number) => {
    let value = getBlobValue(main, u, v, mainSlope);
    for (const satellite of satellites) {
      value = Math.max(value, getBlobValue(satellite, u, v, SATELLITE_SLOPE));
    }
    return value;
  };
};

/**
 * Mainland along the open border, a neck reaching into the sea and a broad head. The first
 * point coordinate runs from the open border (-1) towards the opposite border (+1).
 */
const createPeninsulaShape = (random: Random, openSide: OpenSide) => {
  const coastDepth = randomBetween(random, 0.3, 0.45);
  const base: [number, number] = [-1.3, randomBetween(random, -0.3, 0.3)];
  const headAcross = Math.max(-0.4, Math.min(0.4, base[1] + randomBetween(random, -0.35, 0.35)));
  const head = {
    radius: randomBetween(random, 0.42, 0.52),
    u: randomBetween(random, 0.2, 0.32),
    v: headAcross
  };
  const neckWidth = randomBetween(random, 0.26, 0.34);
  return (u: number, v: number) => {
    const point: [number, number] = openSide === "x0" ? [u, v] : [v, u];
    const mainland = (coastDepth - (point[0] + 1)) * ISLAND_SLOPE;
    const neck = (neckWidth - distanceToSegmentXZ(point[0], point[1], base[0], base[1], head.u, head.v)) * ISLAND_SLOPE;
    const bulb = getBlobValue(head, point[0], point[1], ISLAND_SLOPE);
    return Math.max(mainland, neck, bulb);
  };
};

/** Seeded layout of the given landform (the shape's own randomness comes from the seed). */
export const createLandformLayout = (seed: number, kind: Landform): LandformLayout => {
  const random = createRandom(deriveSeed(seed, "landform-layout"));
  if (kind === "archipelago") {
    return { kind, openSide: null, shape: createArchipelagoShape(random) };
  }
  if (kind === "peninsula") {
    const openSide: OpenSide = random() < 0.5 ? "x0" : "z0";
    return { kind, openSide, shape: createPeninsulaShape(random, openSide) };
  }
  return { kind, openSide: null, shape: createIslandShape(random) };
};
