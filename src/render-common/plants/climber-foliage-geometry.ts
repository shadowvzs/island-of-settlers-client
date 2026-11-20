import type { Point3 } from "../buildings/building-recipe";
import { cross, dot, normalize, type Vec3 } from "../props/mesh-builder";
import type { RoadClimberStem, RoadFoliageCard, RoadRoseHead } from "../road-decoration-recipe";
import { climberFoliageCardVertices, getClimberFoliageTile } from "./climber-foliage-atlas-manifest";
import type { FoliageCardVertices } from "./foliage-atlas-layout";

/**
 * Worker-safe vertex layout of the climber foliage parts. The Three builders and the physical
 * clearance read the same positions, so a card's reserved box is exactly what is drawn.
 */
export interface FoliageSurface {
  /** Triangle indices into the vertex arrays. */
  indices: number[];
  normals: Vec3[];
  positions: Vec3[];
  uvs: [number, number][];
}

const add = (a: Vec3, b: Vec3, scale = 1): Vec3 => [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
const blend = (terms: readonly (readonly [Vec3, number])[]) =>
  normalize(terms.reduce<Vec3>((sum, [vector, weight]) => add(sum, vector, weight), [0, 0, 0]));

/** Orthonormal card frame: `up` along the tile's +v, `normal` towards `facing`, `right` = up x normal. */
export const foliageCardFrame = (up: Vec3, facing: Vec3) => {
  const along = normalize(up);
  let side = cross(along, facing);
  if (Math.hypot(...side) < 1e-6) side = cross(along, Math.abs(along[1]) < .9 ? [0, 1, 0] : [1, 0, 0]);
  const right = normalize(side), normal = normalize(cross(right, along));
  return { normal, right, up: along };
};

/** Where and how a card stands; shared by the climber recipes and the verge plants. */
export interface FoliageCardPose {
  /** Backward bend of the far edge (world units). */
  curl?: number;
  /** Approximate front normal; orthogonalised against `up`. */
  facing: Vec3;
  /** Attachment point (the tile pivot). */
  position: Vec3;
  /** World size of one tile edge. */
  size: number;
  /** Growth direction of the tile's +v axis. */
  up: Vec3;
}

/** The tile's trimmed 8-gon, scaled to the card, arched backwards by `curl`, with softly domed normals. */
export const foliageCardPoseSurface = (card: FoliageCardPose, vertices: FoliageCardVertices): FoliageSurface => {
  const { positions: outline, uvs } = vertices;
  const { normal, right, up } = foliageCardFrame(card.up, card.facing);
  const reach = Math.max(...outline.map(([, v]) => Math.abs(v)), 1e-6);
  const halfWidth = Math.max(...outline.map(([u]) => Math.abs(u)), 1e-6);
  const curl = card.curl ?? 0;
  const positions = outline.map(([u, v]): Vec3 => {
    const along = v / reach;
    return add(add(add(card.position, right, u * card.size), up, v * card.size), normal, -curl * along * along);
  });
  // Bent ~25 degrees outward from the midrib and back along the curl: soft, volume-like light.
  const normals = outline.map(([u, v]) => blend([[normal, 1], [right, u / halfWidth * .45],
    [up, curl / card.size * 2 * v / reach + .12]]));
  const indices: number[] = [];
  for (let index = 1; index < outline.length - 1; index++) indices.push(0, index, index + 1);
  return { indices, normals, positions, uvs };
};

export const foliageCardSurface = (card: RoadFoliageCard) =>
  foliageCardPoseSurface(card, climberFoliageCardVertices(card.tile));

interface Whorl { count: number; length: number; open: number; offset: number; reach: number;
  rows: number; rise: number; tile: "rose-petal-outer" | "rose-petal-inner"; width: number }
/** Outer to inner: 5 spreading, 5 half-open, 4 incurved petals (lengths relative to the head radius). */
const WHORLS: readonly Whorl[] = [
  { count: 5, length: .98, open: 1.2, offset: 0, reach: .18, rows: 3, rise: 0, tile: "rose-petal-outer", width: .98 },
  { count: 5, length: .82, open: .74, offset: .63, reach: .11, rows: 2, rise: .09, tile: "rose-petal-outer", width: .8 },
  { count: 4, length: .62, open: .3, offset: .39, reach: .05, rows: 2, rise: .17, tile: "rose-petal-inner", width: .62 }
];

const tileBox = (id: Whorl["tile"]) => {
  const tile = getClimberFoliageTile(id), us = tile.outline.map(([u]) => u), vs = tile.outline.map(([, v]) => v);
  return { rect: tile.uvRect, u0: Math.min(...us), u1: Math.max(...us), v0: tile.pivot[1], v1: Math.max(...vs) };
};

const petalNoise = (seed: number) => {
  const value = Math.sin(seed * 91.7 + 17.3) * 43758.5453;
  return value - Math.floor(value);
};

const appendPetal = (surface: FoliageSurface, head: RoadRoseHead, frame: ReturnType<typeof foliageCardFrame>,
  whorl: Whorl, angle: number, jitter: number) => {
  const { normal: axis, right: b1, up: b2 } = frame;
  const outward = normalize(add(add([0, 0, 0], b1, Math.cos(angle)), b2, Math.sin(angle)));
  const tangent = normalize(cross(axis, outward));
  const open = whorl.open + (jitter - .5) * .16;
  const direction = normalize(add(add([0, 0, 0], axis, Math.cos(open)), outward, Math.sin(open)));
  const inward = normalize(cross(tangent, direction));
  const length = whorl.length * head.radius, width = whorl.width * head.radius;
  const base = add(add(head.position, axis, whorl.rise * head.radius), outward, whorl.reach * head.radius);
  const box = tileBox(whorl.tile), first = surface.positions.length;
  // Outer petals reflex slightly at the tip; inner ones curl in over the centre.
  const tipCurl = whorl.open > 1 ? -.12 : .22;
  for (let row = 0; row < whorl.rows; row++) for (let column = 0; column < 3; column++) {
    const along = row / (whorl.rows - 1), across = column - 1;
    const cup = (across * across) * width * .34 * (.35 + along);
    const point = add(add(add(add(base, direction, length * along), tangent, across * width * .5), inward, cup),
      inward, tipCurl * along * along * length);
    surface.positions.push(point);
    surface.normals.push(blend([[inward, 1], [tangent, -across * .55], [direction, -.15]]));
    const u = box.u0 + (box.u1 - box.u0) * (across + 1) / 2, v = box.v0 + (box.v1 - box.v0) * along;
    surface.uvs.push([box.rect[0] + (box.rect[2] - box.rect[0]) * u, box.rect[1] + (box.rect[3] - box.rect[1]) * v]);
  }
  for (let row = 0; row < whorl.rows - 1; row++) for (let column = 0; column < 2; column++) {
    const at = first + row * 3 + column;
    surface.indices.push(at, at + 1, at + 4, at, at + 4, at + 3);
  }
};

/** About 76 petal triangles; the calyx is a separate card part (tile 6) behind the receptacle. */
export const roseHeadSurface = (head: RoadRoseHead): FoliageSurface => {
  const surface: FoliageSurface = { indices: [], normals: [], positions: [], uvs: [] };
  // The frame's `normal` is the flower axis; `right` and `up` span the petal ring.
  const ring = foliageCardFrame(Math.abs(head.axis[1]) < .95 ? [0, 1, 0] : [1, 0, 0], head.axis);
  for (const [whorlIndex, whorl] of WHORLS.entries()) for (let petal = 0; petal < whorl.count; petal++) {
    const jitter = petalNoise(head.seed * 31 + whorlIndex * 7 + petal);
    const angle = (petal + whorl.offset + (jitter - .5) * .18) / whorl.count * Math.PI * 2 + head.seed;
    appendPetal(surface, head, ring, whorl, angle, jitter);
  }
  return surface;
};

/** Rotation-minimising tube rings along a stem polyline (shared joints, no overlapping cylinders). */
export const climberStemRings = (stem: RoadClimberStem) => {
  const { points } = stem, rings: { centre: Vec3; normal: Vec3; binormal: Vec3; radius: number }[] = [];
  let lengthSoFar = 0;
  const lengths = points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)]!;
    lengthSoFar += Math.hypot(point[0] - previous[0], point[1] - previous[1], point[2] - previous[2]);
    return lengthSoFar;
  });
  let normal: Vec3 | undefined;
  for (let index = 0; index < points.length; index++) {
    const previous = points[Math.max(0, index - 1)]!, next = points[Math.min(points.length - 1, index + 1)]!;
    const tangent = normalize([next[0] - previous[0], next[1] - previous[1], next[2] - previous[2]]);
    if (!normal) normal = normalize(cross(tangent, Math.abs(tangent[1]) < .9 ? [0, 1, 0] : [1, 0, 0]));
    else normal = normalize(add(normal, tangent, -dot(normal, tangent)));
    const t = lengthSoFar > 0 ? lengths[index]! / lengthSoFar : 0;
    rings.push({ binormal: normalize(cross(tangent, normal)), centre: points[index]!, normal,
      radius: stem.radius[0] + (stem.radius[1] - stem.radius[0]) * t });
  }
  return { lengths, rings };
};

export interface FoliageBounds { max: Point3; min: Point3 }
const boundsOf = (points: readonly Vec3[], pad = 0): FoliageBounds => ({
  max: [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis]!)) + pad) as Point3,
  min: [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis]!)) - pad) as Point3
});

/** A long cane is reserved as short runs of its tube, so a cane arching over the road never boxes the opening. */
export const climberStemVolumes = (stem: RoadClimberStem, segmentsPerVolume = 3): FoliageBounds[] => {
  const pad = Math.max(stem.radius[0], stem.radius[1]) + .002, volumes: FoliageBounds[] = [];
  for (let first = 0; first < stem.points.length - 1; first += segmentsPerVolume)
    volumes.push(boundsOf(stem.points.slice(first, first + segmentsPerVolume + 1), pad));
  return volumes;
};

/**
 * Static drawn extent plus a 4 mm pad. High leaf flutter (at most ~0.03 at storm strength) is kept
 * clear of traffic by the recipes' opening margin, not by these boxes.
 */
export const foliagePartBounds = (part: RoadFoliageCard | RoadRoseHead | RoadClimberStem): FoliageBounds => {
  if (part.kind === "foliage-card") return boundsOf(foliageCardSurface(part).positions, .004);
  if (part.kind === "rose-head") return boundsOf(roseHeadSurface(part).positions, .004);
  return boundsOf(part.points, Math.max(part.radius[0], part.radius[1]) + .002);
};
