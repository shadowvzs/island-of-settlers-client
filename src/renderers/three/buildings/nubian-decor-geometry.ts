import { BufferGeometry, Float32BufferAttribute, PlaneGeometry, Vector3 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { BuildingPart } from "../../../render-common/buildings/building-recipe";
import { smoothstep } from "../../../shared/world/noise";
import {
  type AtlasRegion,
  NUBIAN_DECOR_ATLAS,
  nubianTextileRegion,
  regionUv} from "./nubian-decor-atlas";

type Profile = ReadonlyArray<readonly [number, number]>;

/**
 * A lathe around Y from a (radius, height) profile, ordered bottom to top so the outside faces out.
 * Normals come from the profile tangent (no seam crease); `uv` gets the angle 0…1 and the profile
 * arc length 0…1.
 */
const lathe = (
  profile: Profile,
  segments: number,
  uv: (around: number, along: number) => [number, number]
) => {
  const lengths = [0];
  for (let index = 1; index < profile.length; index++)
    lengths.push(
      lengths[index - 1]! +
        Math.hypot(
          profile[index]![0] - profile[index - 1]![0],
          profile[index]![1] - profile[index - 1]![1]
        )
    );
  const total = lengths.at(-1)!,
    positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [];
  profile.forEach(([radius, y], index) => {
    const before = profile[Math.max(0, index - 1)]!,
      after = profile[Math.min(profile.length - 1, index + 1)]!;
    const dr = after[0] - before[0],
      dy = after[1] - before[1],
      length = Math.hypot(dr, dy) || 1;
    for (let step = 0; step <= segments; step++) {
      const angle = (step / segments) * Math.PI * 2,
        cos = Math.cos(angle),
        sin = Math.sin(angle);
      positions.push(radius * cos, y, -radius * sin);
      normals.push((dy / length) * cos, -dr / length, (-dy / length) * sin);
      uvs.push(...uv(step / segments, lengths[index]! / total));
    }
  });
  const indices: number[] = [];
  for (let row = 0; row < profile.length - 1; row++)
    for (let step = 0; step < segments; step++) {
      const a = row * (segments + 1) + step,
        b = a + segments + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  return indexedGeometry(positions, normals, uvs, indices);
};

const indexedGeometry = (
  positions: number[],
  normals: number[] | null,
  uvs: number[],
  indices: number[]
) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  if (normals) geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  else geometry.computeVertexNormals();
  return geometry;
};

/**
 * Jar profiles (radius, height in a unit box, bottom to lip, a little down inside the mouth):
 * an egg-bodied water jar, a round shouldered pot, a slender Meroitic bottle. Flags mark the
 * points kept on Minimal.
 */
const VASE_PROFILES: ReadonlyArray<ReadonlyArray<readonly [number, number, boolean]>> = [
  [
    [0, -0.5, true],
    [0.26, -0.5, true],
    [0.46, -0.22, true],
    [0.44, 0.1, false],
    [0.3, 0.3, true],
    [0.18, 0.41, false],
    [0.25, 0.5, true],
    [0.15, 0.42, false]
  ],
  [
    [0, -0.5, true],
    [0.28, -0.5, true],
    [0.48, -0.24, false],
    [0.48, 0.02, true],
    [0.34, 0.3, true],
    [0.27, 0.4, false],
    [0.33, 0.5, true],
    [0.22, 0.42, false]
  ],
  [
    [0, -0.5, true],
    [0.2, -0.5, true],
    [0.36, -0.26, false],
    [0.4, -0.04, true],
    [0.3, 0.26, true],
    [0.16, 0.4, false],
    [0.22, 0.5, true],
    [0.12, 0.42, false]
  ]
];

const createVase = (variant: number, detailed: boolean) => {
  const profile = VASE_PROFILES[variant % VASE_PROFILES.length]!.filter(
    (point) => detailed || point[2]
  ).map(([radius, y]) => [radius, y] as const);
  const region = NUBIAN_DECOR_ATLAS.vase[variant % NUBIAN_DECOR_ATLAS.vase.length]!;
  return lathe(profile, detailed ? 10 : 6, (around, along) => regionUv(region, around, along));
};

/**
 * A palm-leaf sun hat, bottom to top: drooping brim edge, brim, a conical crown and a bound tip.
 * Painted top-down: the atlas cell is a radial design, centred on the crown tip.
 */
const HAT_PROFILE: ReadonlyArray<readonly [number, number, boolean]> = [
  [0.5, -0.5, true],
  [0.4, -0.36, false],
  [0.22, -0.26, true],
  [0.18, -0.02, false],
  [0.13, 0.22, true],
  [0.07, 0.4, false],
  [0.035, 0.5, true],
  [0, 0.5, true]
];

const createHat = (variant: number, detailed: boolean) => {
  const profile = HAT_PROFILE.filter((point) => detailed || point[2]).map(
    ([radius, y]) => [radius, y] as const
  );
  const region = NUBIAN_DECOR_ATLAS.hat[variant % NUBIAN_DECOR_ATLAS.hat.length]!;
  // Radial painting: the profile's arc length from the tip becomes the distance from the cell centre.
  return lathe(profile, detailed ? 12 : 7, (around, along) => {
    const radius = (1 - along) * 0.5,
      angle = around * Math.PI * 2;
    return regionUv(region, 0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius);
  });
};

/** Shield shell rings: (relative radius, height in the unit box); the outer two roll back into a rim. */
const SHIELD_RINGS: ReadonlyArray<readonly [number, number, boolean]> = [
  [0.4, 0.4, false],
  [0.72, 0.18, true],
  [0.92, -0.12, true],
  [0.98, -0.26, false],
  [1, -0.5, true]
];

/** A convex tall-oval hide shield facing +Z, planar-mapped onto its painted cell. */
const createShield = (variant: number, detailed: boolean) => {
  const region = NUBIAN_DECOR_ATLAS.shield[variant % NUBIAN_DECOR_ATLAS.shield.length]!;
  const segments = detailed ? 16 : 10,
    rings = SHIELD_RINGS.filter((ring) => detailed || ring[2]);
  const positions = [0, 0, 0.5],
    uvs = [...regionUv(region, 0.5, 0.5)],
    indices: number[] = [];
  for (const [radius, z] of rings)
    for (let step = 0; step < segments; step++) {
      const angle = (step / segments) * Math.PI * 2,
        x = Math.cos(angle) * radius * 0.5,
        y = Math.sin(angle) * radius * 0.5;
      positions.push(x, y, z);
      uvs.push(...regionUv(region, x + 0.5, y + 0.5));
    }
  for (let step = 0; step < segments; step++)
    indices.push(0, 1 + step, 1 + ((step + 1) % segments));
  for (let ring = 0; ring < rings.length - 1; ring++)
    for (let step = 0; step < segments; step++) {
      const a = 1 + ring * segments + step,
        b = 1 + ring * segments + ((step + 1) % segments);
      indices.push(a, a + segments, b, b, a + segments, b + segments);
    }
  return indexedGeometry(positions, null, uvs, indices);
};

/** Smooth ramp 0…1 between `from` and `to`. */
const hornCurve = (variant: number, side: number, t: number) =>
  variant === 0
    ? // Kerma long-horned cattle: out sideways from the poll, then up, the tips turning in like a lyre.
      new Vector3(
        side *
          (0.26 +
            0.55 * Math.sin(((Math.min(t, 0.7) / 0.7) * Math.PI) / 2) -
            0.1 * smoothstep(0.7, 1, t)),
        0.46 + 0.05 * t + 0.55 * Math.pow(t, 2.2),
        0.08 * t
      )
    : // Oryx: long, nearly straight ringed horns rising from the poll and sweeping back.
      new Vector3(side * (0.1 + 0.12 * t), 0.45 + 0.85 * t, -0.12 * t * t);

/** A tapering horn tube from the poll to the tip; v runs base to tip, u round the horn. */
const createHorn = (variant: number, side: number, detailed: boolean) => {
  const rings = detailed ? 6 : 3,
    segments = detailed ? 5 : 3,
    region = NUBIAN_DECOR_ATLAS.horn[variant]!;
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (let ring = 0; ring <= rings; ring++) {
    const t = ring / rings,
      center = hornCurve(variant, side, t);
    const tangent = hornCurve(variant, side, Math.min(1, t + 0.02))
      .sub(hornCurve(variant, side, Math.max(0, t - 0.02)))
      .normalize();
    const normal = new Vector3(0, 0, 1).cross(tangent).normalize(),
      binormal = tangent.clone().cross(normal);
    const radius = (variant === 0 ? 0.08 : 0.055) * (1 - t * 0.85);
    for (let step = 0; step <= segments; step++) {
      const angle = (step / segments) * Math.PI * 2;
      const offset = normal
        .clone()
        .multiplyScalar(Math.cos(angle) * radius)
        .add(binormal.clone().multiplyScalar(Math.sin(angle) * radius));
      positions.push(center.x + offset.x, center.y + offset.y, center.z + offset.z);
      uvs.push(...regionUv(region, step / segments, t));
    }
  }
  for (let ring = 0; ring < rings; ring++)
    for (let step = 0; step < segments; step++) {
      const a = ring * (segments + 1) + step,
        b = a + segments + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  return indexedGeometry(positions, null, uvs, indices);
};

/** Width of the long face from the muzzle (0) to the poll (1), with the eye orbits standing out. */
const SKULL_WIDTHS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.42],
  [0.2, 0.32],
  [0.45, 0.56],
  [0.66, 1],
  [0.8, 0.84],
  [1, 0.92]
];
const skullWidth = (t: number) => {
  const index = Math.max(
    1,
    SKULL_WIDTHS.findIndex(([at]) => at >= t)
  );
  const [from, start] = SKULL_WIDTHS[index - 1]!,
    [to, end] = SKULL_WIDTHS[index]!;
  return start + (end - start) * smoothstep(from, to, t);
};

/** Widest half-width of the face (at the orbits), for the front-on bone mapping. */
const CRANIUM_HALF_WIDTH = 0.31;

/**
 * The skull: a long face narrowing to the muzzle, flat behind (it hangs on the wall), the orbits
 * standing out, painted front-on from the bone cell.
 */
const createCranium = (detailed: boolean) => {
  const columns = detailed ? 8 : 5,
    rows = detailed ? 6 : 4;
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (let row = 0; row <= rows; row++) {
    const polar = (row / rows) * Math.PI,
      y = -Math.cos(polar),
      t = (y + 1) / 2,
      ring = Math.sin(polar);
    for (let column = 0; column <= columns; column++) {
      const angle = (column / columns) * Math.PI * 2,
        x = Math.cos(angle) * ring * skullWidth(t) * 0.31;
      const depth = Math.sin(angle) * ring,
        z = depth > 0 ? depth * 0.22 * (0.55 + 0.45 * t) : depth * 0.05;
      positions.push(x, y * 0.5, z);
      uvs.push(...regionUv(NUBIAN_DECOR_ATLAS.bone, x / (CRANIUM_HALF_WIDTH * 2) + 0.5, t));
    }
  }
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column,
        b = a + columns + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  return indexedGeometry(positions, null, uvs, indices);
};

/** Scales a geometry into the unit box the recipe part's size stretches. */
const fitUnitBox = (geometry: BufferGeometry) => {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!,
    size = box.getSize(new Vector3()),
    center = box.getCenter(new Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(1 / size.x, 1 / size.y, 1 / size.z);
  return geometry;
};

const createSkull = (variant: number, detailed: boolean) => {
  const parts = [
    createCranium(detailed),
    createHorn(variant, -1, detailed),
    createHorn(variant, 1, detailed)
  ];
  const merged = mergeGeometries(parts)!;
  parts.forEach((part) => part.dispose());
  merged.computeVertexNormals();
  return fitUnitBox(merged);
};

/** A woven hanging: High folds it into a grid that the wind shader can ripple. */
const createTextile = (variant: number, detailed: boolean) => {
  const geometry = new PlaneGeometry(1, 1, detailed ? 4 : 1, detailed ? 6 : 1);
  const uv = geometry.getAttribute("uv"),
    region: AtlasRegion = nubianTextileRegion(variant);
  for (let index = 0; index < uv.count; index++)
    uv.setXY(index, region.u0 + uv.getX(index) * (region.u1 - region.u0), uv.getY(index));
  return geometry;
};

/** Geometry for the Nubian decor shapes, or null for every other shape. */
export const createNubianDecorGeometry = (
  part: BuildingPart,
  detailed: boolean
): BufferGeometry | null => {
  const variant = part.decorVariant ?? 0;
  if (part.shape === "nubian-textile") return createTextile(variant, detailed);
  if (part.shape === "nubian-vase") return createVase(variant, detailed);
  if (part.shape === "nubian-shield") return createShield(variant, detailed);
  if (part.shape === "nubian-skull") return createSkull(variant, detailed);
  if (part.shape === "nubian-hat") return createHat(variant, detailed);
  return null;
};
