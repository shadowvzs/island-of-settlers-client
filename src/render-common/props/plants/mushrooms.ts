import { lerp3 } from "../../../shared/world/noise";
import type { Random } from "../../../shared/world/rng";
import { cross, MeshBuilder, normalize, type PropMesh, type Vec3, type VertexStyle } from "../mesh-builder";

/**
 * Forest-floor mushroom clumps (original procedural models, owner 2026-11-09): smooth domed
 * caps with an in-rolled margin, a darker crown, faint radial streaks and gill-coloured
 * undersides on gently leaning, tapered stems. Variants: a red cap with cream warts, a chunky
 * chestnut bolete and an ochre cap with pale flecks. Colours stay below the bloom threshold, so
 * a sunlit cap reads as a lit surface, never as a light.
 *
 * LOD: the caps, stems and warts are core; the stem skirt, the base bulb and the small
 * button mushroom are plant detail (drawn from the close plant zoom only).
 */

interface MushroomSpecies {
  cap: Vec3;
  /** Darker crown colour the cap fades to at its apex. */
  crown: Vec3;
  gills: Vec3;
  /** Cap radius range and its height over radius (young caps rounder, old flatter). */
  radius: readonly [number, number];
  roundness: readonly [number, number];
  /** Stem radius as a share of the cap radius, stem height as a multiple of it. */
  stemHeight: readonly [number, number];
  stemShare: number;
  stem: Vec3;
  stems: readonly [number, number];
  /** Warts / flecks on the cap (count range); none for a plain cap. */
  warts?: { color: Vec3; count: readonly [number, number]; size: number };
  /** Membranous ring under the cap (plant detail). */
  skirt: boolean;
}

const SPECIES: readonly MushroomSpecies[] = [
  {
    cap: [0.54, 0.1, 0.06],
    crown: [0.38, 0.06, 0.04],
    gills: [0.76, 0.72, 0.6],
    radius: [0.06, 0.09],
    roundness: [0.36, 0.75],
    skirt: true,
    stem: [0.8, 0.74, 0.6],
    stemHeight: [1.9, 2.5],
    stemShare: 0.2,
    stems: [3, 4],
    warts: { color: [0.7, 0.66, 0.55], count: [6, 9], size: 0.14 }
  },
  {
    cap: [0.44, 0.26, 0.13],
    crown: [0.3, 0.16, 0.08],
    gills: [0.6, 0.55, 0.28],
    radius: [0.065, 0.095],
    roundness: [0.42, 0.65],
    skirt: false,
    stem: [0.66, 0.58, 0.44],
    stemHeight: [1.35, 1.7],
    stemShare: 0.32,
    stems: [2, 3]
  },
  {
    cap: [0.54, 0.38, 0.19],
    crown: [0.34, 0.21, 0.1],
    gills: [0.74, 0.68, 0.54],
    radius: [0.045, 0.07],
    roundness: [0.38, 0.8],
    skirt: false,
    stem: [0.78, 0.7, 0.54],
    stemHeight: [2.1, 2.8],
    stemShare: 0.18,
    stems: [3, 4],
    warts: { color: [0.68, 0.62, 0.5], count: [4, 6], size: 0.11 }
  }
];

const CAP_SEGMENTS = 10;
/** Latitude rings from the margin (0) to just below the apex. */
const CAP_RINGS = [0, 0.3, 0.58, 0.82];
const STEM_SEGMENTS = 6;
/** Stem rings (height share) and their radius factors: a slight bulb, then a gentle taper. */
const STEM_PROFILE: readonly (readonly [number, number])[] = [[0, 1.3], [0.14, 1.02], [1, 0.82]];

const range = (random: Random, [low, high]: readonly [number, number]) => low + random() * (high - low);

const solid = (color: Vec3): VertexStyle => ({ color: () => color, flutter: 0 });

const tint = (color: Vec3, factor: number): Vec3 => [color[0] * factor, color[1] * factor, color[2] * factor];

/** A cap placed on its stem: centre of the margin plane, size, shape and lean. */
interface Cap {
  centre: Vec3;
  height: number;
  /** Small horizontal margin waviness phase. */
  phase: number;
  radius: number;
  tilt: readonly [number, number];
}

/** Point and normal of the cap surface at latitude t (0 margin .. 1 apex) and azimuth. */
const capSurface = (cap: Cap, t: number, azimuth: number): [Vec3, Vec3] => {
  const angle = (t * Math.PI) / 2;
  const wave = 1 + 0.035 * Math.sin(azimuth * 3 + cap.phase) * (1 - t);
  const radial = cap.radius * Math.cos(angle) * wave;
  const lift = cap.height * Math.sin(angle);
  const cos = Math.cos(azimuth), sin = Math.sin(azimuth);
  const x = cos * radial, z = sin * radial;
  const position: Vec3 = [
    cap.centre[0] + x,
    cap.centre[1] + lift + x * cap.tilt[0] + z * cap.tilt[1],
    cap.centre[2] + z
  ];
  const normal = normalize([
    (cos * Math.cos(angle)) / cap.radius - cap.tilt[0] * Math.sin(angle) / cap.height,
    Math.sin(angle) / cap.height,
    (sin * Math.cos(angle)) / cap.radius - cap.tilt[1] * Math.sin(angle) / cap.height
  ]);
  return [position, normal];
};

/** Cap colour: darker crown, faint radial streaks, a slightly paler margin. */
const capColor = (species: MushroomSpecies, t: number, azimuth: number, phase: number): Vec3 => {
  const base = lerp3(species.cap, species.crown, Math.pow(t, 1.6));
  const streak = 1 + 0.07 * Math.sin(azimuth * 9 + phase) * (1 - t);
  const margin = t < 0.1 ? 1.08 : 1;
  return [base[0] * streak * margin, base[1] * streak * margin, base[2] * streak * margin];
};

const addCapTop = (builder: MeshBuilder, species: MushroomSpecies, cap: Cap) => {
  const first = builder.vertexCount;
  for (const t of CAP_RINGS) {
    for (let segment = 0; segment <= CAP_SEGMENTS; segment += 1) {
      const azimuth = (segment / CAP_SEGMENTS) * Math.PI * 2;
      const [position, normal] = capSurface(cap, t, azimuth);
      builder.addVertex(position, normal, solid(capColor(species, t, azimuth, cap.phase)));
    }
  }
  const row = CAP_SEGMENTS + 1;
  for (let ring = 0; ring < CAP_RINGS.length - 1; ring += 1) {
    for (let segment = 0; segment < CAP_SEGMENTS; segment += 1) {
      const a = first + ring * row + segment;
      builder.addTriangle(a, a + row, a + 1);
      builder.addTriangle(a + 1, a + row, a + row + 1);
    }
  }
  const [apexPosition, apexNormal] = capSurface(cap, 1, 0);
  const apex = builder.addVertex(apexPosition, apexNormal, solid(species.crown));
  const top = first + (CAP_RINGS.length - 1) * row;
  for (let segment = 0; segment < CAP_SEGMENTS; segment += 1) builder.addTriangle(top + segment, apex, top + segment + 1);
};

/**
 * In-rolled margin and the gill underside: a short lip curling under the rim, then a shallow
 * cone up to the stem; alternate rim vertices are shaded darker as gill lines.
 */
const addCapUnderside = (builder: MeshBuilder, species: MushroomSpecies, cap: Cap, stemRadius: number) => {
  const first = builder.vertexCount;
  const lip = cap.radius * 0.06;
  for (let segment = 0; segment <= CAP_SEGMENTS; segment += 1) {
    const azimuth = (segment / CAP_SEGMENTS) * Math.PI * 2;
    const [rim] = capSurface(cap, 0, azimuth);
    const cos = Math.cos(azimuth), sin = Math.sin(azimuth);
    const inner: Vec3 = [rim[0] - cos * lip, rim[1] - lip * 0.8, rim[2] - sin * lip];
    const gill = segment % 2 === 0 ? 1 : 0.82;
    builder.addVertex(rim, [cos * 0.3, -1, sin * 0.3], solid(capColor(species, 0, azimuth, cap.phase)));
    builder.addVertex(inner, [0, -1, 0], solid(tint(species.gills, gill)));
    builder.addVertex(
      [cap.centre[0] + cos * stemRadius, cap.centre[1] + cap.height * 0.12, cap.centre[2] + sin * stemRadius],
      [0, -1, 0],
      solid(tint(species.gills, 0.72))
    );
  }
  for (let segment = 0; segment < CAP_SEGMENTS; segment += 1) {
    const a = first + segment * 3;
    builder.addTriangle(a, a + 3, a + 1);
    builder.addTriangle(a + 1, a + 3, a + 4);
    builder.addTriangle(a + 1, a + 4, a + 2);
    builder.addTriangle(a + 2, a + 4, a + 5);
  }
};

/** Irregular flat wart lying on the cap surface (a small polygon slightly above it). */
const addWart = (builder: MeshBuilder, cap: Cap, color: Vec3, size: number, random: Random) => {
  const t = 0.12 + random() * 0.8;
  const [centre, normal] = capSurface(cap, t, random() * Math.PI * 2);
  const helper: Vec3 = Math.abs(normal[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(normal, helper));
  const v = cross(normal, u);
  const radius = cap.radius * size * (0.6 + random() * 0.7);
  const lifted: Vec3 = [centre[0] + normal[0] * 0.0015, centre[1] + normal[1] * 0.0015, centre[2] + normal[2] * 0.0015];
  const middle = builder.addVertex(lifted, normal, solid(color));
  const corners = 5;
  const first = builder.vertexCount;
  for (let corner = 0; corner < corners; corner += 1) {
    const angle = (corner / corners) * Math.PI * 2;
    const reach = radius * (0.7 + random() * 0.45);
    const along = Math.cos(angle) * reach, across = Math.sin(angle) * reach;
    builder.addVertex(
      [lifted[0] + u[0] * along + v[0] * across, lifted[1] + u[1] * along + v[1] * across,
        lifted[2] + u[2] * along + v[2] * across],
      normal,
      solid(tint(color, 0.94))
    );
  }
  for (let corner = 0; corner < corners; corner += 1)
    builder.addTriangle(middle, first + corner, first + ((corner + 1) % corners));
};

/** Stem axis point at a height share: a gentle lean that grows towards the cap. */
const stemPoint = (base: Vec3, height: number, lean: readonly [number, number], share: number): Vec3 => [
  base[0] + lean[0] * share * share,
  base[1] + height * share,
  base[2] + lean[1] * share * share
];

/** Tapered stem with a slight bulb, soil-darkened at the foot and paler under the cap. */
const addStem = (
  builder: MeshBuilder,
  species: MushroomSpecies,
  base: Vec3,
  size: { height: number; lean: readonly [number, number]; radius: number }
) => {
  const first = builder.vertexCount;
  for (const [share, factor] of STEM_PROFILE) {
    const centre = stemPoint(base, size.height, size.lean, share);
    const color = tint(species.stem, 0.62 + 0.38 * Math.min(1, share * 2.5));
    for (let segment = 0; segment <= STEM_SEGMENTS; segment += 1) {
      const azimuth = (segment / STEM_SEGMENTS) * Math.PI * 2;
      const cos = Math.cos(azimuth), sin = Math.sin(azimuth);
      const radius = size.radius * factor;
      builder.addVertex([centre[0] + cos * radius, centre[1], centre[2] + sin * radius], [cos, 0.1, sin],
        solid(tint(color, segment % 2 === 0 ? 1 : 0.95)));
    }
  }
  const row = STEM_SEGMENTS + 1;
  for (let ring = 0; ring < STEM_PROFILE.length - 1; ring += 1) {
    for (let segment = 0; segment < STEM_SEGMENTS; segment += 1) {
      const a = first + ring * row + segment;
      builder.addTriangle(a, a + row, a + 1);
      builder.addTriangle(a + 1, a + row, a + row + 1);
    }
  }
};

/** Hanging membranous ring a little below the cap (plant detail): a short flared frustum. */
const addSkirt = (builder: MeshBuilder, species: MushroomSpecies, top: Vec3, radius: number) => {
  const first = builder.vertexCount;
  const drop = radius * 1.6;
  for (let segment = 0; segment <= STEM_SEGMENTS; segment += 1) {
    const azimuth = (segment / STEM_SEGMENTS) * Math.PI * 2;
    const cos = Math.cos(azimuth), sin = Math.sin(azimuth);
    const flare = radius * (1.9 + 0.25 * Math.sin(azimuth * 2 + top[0] * 40));
    builder.addVertex([top[0] + cos * flare, top[1] - drop, top[2] + sin * flare], [cos, -0.4, sin],
      solid(tint(species.stem, 0.9)));
    builder.addVertex([top[0] + cos * radius * 1.05, top[1], top[2] + sin * radius * 1.05], [cos, 0.3, sin],
      solid(species.stem));
  }
  for (let segment = 0; segment < STEM_SEGMENTS; segment += 1) {
    const a = first + segment * 2;
    builder.addTriangle(a, a + 1, a + 2);
    builder.addTriangle(a + 1, a + 3, a + 2);
  }
};

interface MushroomPlacement {
  base: Vec3;
  /** 0 a young button .. 1 a fully opened cap. */
  age: number;
}

/** One mushroom: stem, domed cap, its underside, warts and (detail) skirt. */
const addMushroom = (builder: MeshBuilder, species: MushroomSpecies, placement: MushroomPlacement,
  random: Random) => {
  const capRadius = range(random, species.radius) * (0.55 + 0.45 * placement.age);
  const roundness = species.roundness[1] - (species.roundness[1] - species.roundness[0]) * placement.age;
  const stemRadius = capRadius * species.stemShare;
  const stemHeight = capRadius * range(random, species.stemHeight) * (0.55 + 0.45 * placement.age);
  const leanAngle = random() * Math.PI * 2, leanAmount = capRadius * 0.35 * random();
  const lean = [Math.cos(leanAngle) * leanAmount, Math.sin(leanAngle) * leanAmount] as const;
  addStem(builder, species, placement.base, { height: stemHeight, lean, radius: stemRadius });
  const top = stemPoint(placement.base, stemHeight, lean, 1);
  const capHeight = capRadius * roundness;
  const tiltScale = 0.9 / capRadius;
  const cap: Cap = {
    centre: [top[0], top[1] - capHeight * 0.18, top[2]],
    height: capHeight,
    phase: random() * Math.PI * 2,
    radius: capRadius,
    tilt: [lean[0] * tiltScale * 0.3, lean[1] * tiltScale * 0.3]
  };
  addCapTop(builder, species, cap);
  addCapUnderside(builder, species, cap, stemRadius);
  if (species.warts) {
    const count = Math.round(range(random, species.warts.count) * (0.6 + 0.4 * placement.age));
    for (let wart = 0; wart < count; wart += 1) addWart(builder, cap, species.warts.color, species.warts.size, random);
  }
  if (!species.skirt || placement.age < 0.5) return;
  builder.detail = true;
  addSkirt(builder, species, stemPoint(placement.base, stemHeight * 0.78, lean, 0.78), stemRadius * 0.86);
  builder.detail = false;
};

/** Loose clump: the oldest mushroom in the middle, younger ones spread evenly around it. */
const placeClump = (species: MushroomSpecies, random: Random): MushroomPlacement[] => {
  const count = Math.round(range(random, species.stems));
  const start = random() * Math.PI * 2;
  return Array.from({ length: count }, (_, index) => {
    const angle = start + (index / Math.max(1, count - 1)) * Math.PI * 2 + (random() - 0.5) * 0.6;
    const distance = index === 0 ? 0 : species.radius[1] * (1.55 + random() * 0.8);
    return {
      age: index === 0 ? 1 : 0.35 + random() * 0.6,
      base: [Math.cos(angle) * distance, -0.01, Math.sin(angle) * distance]
    };
  });
};

/**
 * A mushroom clump of one species (variant % species count). Mushrooms do not bend in the wind:
 * the bend and flutter weights are zero.
 */
export const createMushrooms = (random: Random, variant: number): PropMesh => {
  const builder = new MeshBuilder();
  const species = SPECIES[variant % SPECIES.length]!;
  for (const placement of placeClump(species, random)) addMushroom(builder, species, placement, random);
  builder.detail = true;
  const angle = random() * Math.PI * 2;
  addMushroom(builder, species, { age: 0.05, base: [Math.cos(angle) * 0.17, -0.01, Math.sin(angle) * 0.17] },
    random);
  builder.detail = false;
  const mesh = builder.finish();
  mesh.wind.fill(0);
  return mesh;
};
