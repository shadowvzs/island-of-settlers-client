import { createRandom, type Random } from "../../shared/world/rng";
import { dot, normalize, type Vec3 } from "../props/mesh-builder";
import { computeVertexNormals, smoothNormals } from "./helpers";

/**
 * Rock families: blocky (broad planes, heavy), weathered (rounded, eroded), slab (wide and flat,
 * cliff plates and edges), broken (sharp fractured faces, rubble).
 */
export const ROCK_FAMILY = { blocky: 0, weathered: 1, slab: 2, broken: 3, panel: 4 } as const;
export type RockFamily = (typeof ROCK_FAMILY)[keyof typeof ROCK_FAMILY];
export const ROCK_FAMILIES: readonly RockFamily[] = [0, 1, 2, 3, 4];
export const ROCK_VARIANTS = 4;

/** A unit rock (fits about -0.5..0.5 on every axis, base at y -0.5) with per vertex cavity. */
export interface RockShape {
  /** 0 open surface .. 1 tucked between facets (crevice darkening). */
  cavity: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
  positions: Float32Array;
}

interface CutPlane {
  normal: Vec3;
  offset: number;
}


/** Icosphere directions (vertices) and faces; level 2 = 162 vertices, 320 faces. */
const createSphere = (subdivisions: number) => {
  const t = (1 + Math.sqrt(5)) / 2;
  const vertices: Vec3[] = (
    [
      [-1, t, 0],
      [1, t, 0],
      [-1, -t, 0],
      [1, -t, 0],
      [0, -1, t],
      [0, 1, t],
      [0, -1, -t],
      [0, 1, -t],
      [t, 0, -1],
      [t, 0, 1],
      [-t, 0, -1],
      [-t, 0, 1]
    ] as Vec3[]
  ).map(normalize);
  let faces: number[][] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1]
  ];
  for (let level = 0; level < subdivisions; level += 1) {
    const cache = new Map<string, number>();
    const midpoint = (a: number, b: number) => {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const known = cache.get(key);
      if (known !== undefined) return known;
      const [va, vb] = [vertices[a]!, vertices[b]!];
      vertices.push(normalize([va[0] + vb[0], va[1] + vb[1], va[2] + vb[2]]));
      cache.set(key, vertices.length - 1);
      return vertices.length - 1;
    };
    faces = faces.flatMap(([a, b, c]) => {
      const [ab, bc, ca] = [midpoint(a!, b!), midpoint(b!, c!), midpoint(c!, a!)];
      return [
        [a!, ab, ca],
        [b!, bc, ab],
        [c!, ca, bc],
        [ab, bc, ca]
      ];
    });
  }
  return { faces, vertices };
};

/** Shape detail levels: pebble 20 faces, low 80, high 320. */
export type RockDetail = "pebble" | "low" | "high";
const SPHERES: Record<RockDetail, ReturnType<typeof createSphere>> = {
  high: createSphere(2),
  low: createSphere(1),
  pebble: createSphere(0)
};

/** Family recipes: how many cut planes, how far they sit, how much the result is eroded. */
interface FamilyRecipe {
  /** A tilted box with a few chipped corners (cliff face panels) instead of random cuts. */
  box: boolean;
  /** Plane offsets relative to the radius (low: deep cuts, sharp). */
  depth: [number, number];
  /** Low frequency bulge / dent after cutting (weathering). */
  erosion: number;
  planes: [number, number];
  /** Proportions before cutting (x wide, y tall, z deep). */
  stretch: Vec3;
}

/**
 * Fewer, broader planes than a potato: big planes break up into a few medium ones, cut deep
 * enough for wedge shapes, worn only slightly (reference study, docs/reference/terrain-prototype-log.md).
 */
const RECIPES: Record<RockFamily, FamilyRecipe> = {
  [ROCK_FAMILY.blocky]: {
    box: false,
    depth: [0.52, 0.8],
    erosion: 0.025,
    planes: [7, 11],
    stretch: [1, 0.78, 0.9]
  },
  [ROCK_FAMILY.weathered]: {
    box: false,
    depth: [0.66, 0.9],
    erosion: 0.06,
    planes: [10, 15],
    stretch: [1, 0.72, 0.92]
  },
  [ROCK_FAMILY.slab]: {
    box: false,
    depth: [0.56, 0.86],
    erosion: 0.025,
    planes: [8, 12],
    stretch: [1, 0.38, 0.85]
  },
  [ROCK_FAMILY.broken]: {
    box: false,
    depth: [0.44, 0.76],
    erosion: 0.012,
    planes: [6, 10],
    stretch: [0.9, 0.82, 0.78]
  },
  [ROCK_FAMILY.panel]: {
    box: true,
    depth: [0.64, 0.8],
    erosion: 0.008,
    planes: [3, 7],
    stretch: [1, 1, 1]
  }
};

/**
 * Random cut planes around the rock; the base, the top and the front (+z, the side a cliff slab
 * shows) get broad planes: a flat base reads heavy, a broad face catches light as one plane.
 */
const createPlanes = (recipe: FamilyRecipe, random: Random): CutPlane[] => {
  if (recipe.box) return createBoxPlanes(recipe, random);
  const count = recipe.planes[0] + Math.floor(random() * (recipe.planes[1] - recipe.planes[0]));
  const planes: CutPlane[] = [
    { normal: [0, -1, 0], offset: 0.5 },
    {
      /** A tilted top: many natural stones are wedges, not domes. */
      normal: normalize([(random() - 0.5) * 0.8, 1, (random() - 0.5) * 0.6]),
      offset: 0.5 + random() * 0.15
    },
    {
      normal: normalize([(random() - 0.5) * 0.35, (random() - 0.5) * 0.3, 1]),
      offset: 0.5 + random() * 0.08
    },
    { normal: [0, 0, -1], offset: 0.6 }
  ];
  for (let plane = 0; plane < count; plane += 1) {
    const normal = normalize([random() * 2 - 1, (random() * 2 - 1) * 0.8, random() * 2 - 1]);
    const offset = recipe.depth[0] + random() * (recipe.depth[1] - recipe.depth[0]);
    planes.push({ normal, offset });
  }
  return planes;
};

/** Corner chips: diagonal cuts that break the box silhouette without rounding it. */
const createChips = (recipe: FamilyRecipe, random: Random) => {
  const count = recipe.planes[0] + Math.floor(random() * (recipe.planes[1] - recipe.planes[0]));
  return Array.from({ length: count }, (): CutPlane => {
    const corner: Vec3 = [
      random() < 0.5 ? -1 : 1,
      random() < 0.5 ? -1 : 1,
      random() < 0.5 ? -1 : 1
    ];
    const normal = normalize([
      corner[0] * (0.4 + random()),
      corner[1] * (0.4 + random()),
      corner[2] * (0.4 + random())
    ]);
    return { normal, offset: recipe.depth[0] + random() * (recipe.depth[1] - recipe.depth[0]) };
  });
};

/**
 * Face panel: six broad, slightly tilted planes (front, back, top, base, sides) plus chips. The
 * front (+z) is the big plane a cliff shows; the tilts make neighbouring panels catch light
 * differently, which is what makes a face read as separate geological plates.
 */
const createBoxPlanes = (recipe: FamilyRecipe, random: Random): CutPlane[] => {
  const tilt = () => (random() - 0.5) * 0.3;
  const axes: Vec3[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1]
  ];
  const box = axes.map((axis): CutPlane => {
    const normal = normalize([
      axis[0] + (axis[0] === 0 ? tilt() : 0),
      axis[1] + (axis[1] === 0 ? tilt() : 0),
      axis[2] + (axis[2] === 0 ? tilt() : 0)
    ]);
    return { normal, offset: 0.5 };
  });
  box[4] = { normal: normalize([(random() - 0.5) * 0.6, (random() - 0.5) * 0.5, 1]), offset: 0.5 };
  return [...box, ...createChips(recipe, random)];
};

/** Distance from the centre to the convex hull of the planes along `direction`. */
const getReach = (planes: CutPlane[], direction: Vec3) => {
  let reach = 1.4;
  let plane = 0;
  planes.forEach((cut, index) => {
    const facing = dot(cut.normal, direction);
    if (facing <= 1e-4) return;
    const distance = cut.offset / facing;
    if (distance >= reach) return;
    reach = distance;
    plane = index;
  });
  return { plane, reach };
};

/** Low frequency lumps (weathering) from a few random lobes. */
const createLumps = (random: Random, amount: number) => {
  const lobes = Array.from({ length: 5 }, () => ({
    axis: normalize([random() - 0.5, random() - 0.5, random() - 0.5]),
    strength: (random() - 0.5) * 2 * amount
  }));
  return (direction: Vec3) =>
    lobes.reduce(
      (sum, lobe) => sum + lobe.strength * Math.max(0, dot(direction, lobe.axis)) ** 2,
      1
    );
};

/**
 * Stretches the rock so its bounds are exactly -0.5..0.5 on every axis: the placement size is
 * then the visible size (plane cuts otherwise shrink rocks unevenly). Normals follow the
 * stretch (inverse transpose).
 */
const fitToUnitBox = (positions: Float32Array, normals: Float32Array) => {
  const scales = [0, 1, 2].map((axis) => {
    let min = Infinity;
    let max = -Infinity;
    for (let index = axis; index < positions.length; index += 3) {
      min = Math.min(min, positions[index]!);
      max = Math.max(max, positions[index]!);
    }
    const scale = 1 / Math.max(1e-4, max - min);
    for (let index = axis; index < positions.length; index += 3) {
      positions[index] = (positions[index]! - min) * scale - 0.5;
    }
    return scale;
  });
  for (let index = 0; index < normals.length; index += 3) {
    const normal = normalize([
      normals[index]! / scales[0]!,
      normals[index + 1]! / scales[1]!,
      normals[index + 2]! / scales[2]!
    ]);
    normals.set(normal, index);
  }
};

/**
 * One rock: sphere directions pushed onto the convex hull of random cut planes (flat facets with
 * slightly chamfered edges), stretched to the family's proportions, weathered by broad lumps.
 * Normals follow the facet planes, softened only near edges, so big planes catch light as planes.
 */
export const createRockShape = (
  family: RockFamily,
  variant: number,
  detail: RockDetail
): RockShape => {
  const random = createRandom(9_001 + family * 131 + variant * 17);
  const recipe = RECIPES[family];
  const planes = createPlanes(recipe, random);
  const lumps = createLumps(random, recipe.erosion);
  const sphere = SPHERES[detail];
  const positions = new Float32Array(sphere.vertices.length * 3);
  const normals = new Float32Array(sphere.vertices.length * 3);
  const cavity = new Float32Array(sphere.vertices.length);
  sphere.vertices.forEach((direction, index) => {
    const { plane, reach } = getReach(planes, direction);
    const radius = reach * lumps(direction) * 0.5;
    const point: Vec3 = [
      direction[0] * radius * recipe.stretch[0],
      Math.max(-0.5, direction[1] * radius * recipe.stretch[1]),
      direction[2] * radius * recipe.stretch[2]
    ];
    positions.set(point, index * 3);
    const facet = planes[plane]!.normal;
    const soft = normalize([
      facet[0] * 0.93 + direction[0] * 0.07,
      facet[1] * 0.93 + direction[1] * 0.07,
      facet[2] * 0.93 + direction[2] * 0.07
    ]);
    normals.set(
      normalize([
        soft[0] / recipe.stretch[0],
        soft[1] / recipe.stretch[1],
        soft[2] / recipe.stretch[2]
      ]),
      index * 3
    );
    cavity[index] = Math.min(1, Math.max(0, (0.62 - reach) * 2.2));
  });
  fitToUnitBox(positions, normals);
  const indices = Uint32Array.from(sphere.faces.flatMap(([a, b, c]) => [a!, b!, c!]));
  /** Very smooth shading: averaged normals, so stones read as softly rounded, weathered rock. */
  const smooth = smoothNormals(computeVertexNormals(positions, indices), indices, 1);
  return { cavity, indices, normals: orientOutward(smooth, positions), positions };
};

/** Flips normals that point into the shape (face winding of the sphere is not guaranteed). */
const orientOutward = (normals: Float32Array, positions: Float32Array) => {
  for (let index = 0; index < normals.length; index += 3) {
    const outward =
      normals[index]! * positions[index]! +
      normals[index + 1]! * positions[index + 1]! +
      normals[index + 2]! * positions[index + 2]!;
    if (outward >= 0) continue;
    for (let axis = 0; axis < 3; axis += 1) normals[index + axis] = -normals[index + axis]!;
  }
  return normals;
};

/** Every family x variant at every detail level (cached by the caller). */
export const createRockLibrary = () =>
  ROCK_FAMILIES.map((family) =>
    Array.from({ length: ROCK_VARIANTS }, (_, variant) => ({
      high: createRockShape(family, variant, "high"),
      low: createRockShape(family, variant, "low"),
      pebble: createRockShape(family, variant, "pebble")
    }))
  );

export type RockLibrary = ReturnType<typeof createRockLibrary>;
