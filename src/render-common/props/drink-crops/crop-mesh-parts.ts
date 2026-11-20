import type { Random } from "../../../shared/world/rng";
import { type MeshBuilder, normalize, type Vec3, type VertexStyle, type VertexWind } from "../mesh-builder";
import { getAxisFrame } from "../plants/plant-parts";

/**
 * Shared pieces of the drink crop meshes (vines, rice, hives, coconut clusters): static carpentry
 * that the vegetation wind must not move, and turned (lathe) bodies such as skeps and coconuts.
 */
const STATIC_WIND: VertexWind = { flutter: 0, path: 0 };

/** One flat colour with a little per-vertex jitter; no flutter. */
export const solid = (color: Vec3, random?: Random, jitter = 0.06): VertexStyle => ({
  color: () => {
    const factor = random ? 1 - jitter / 2 + random() * jitter : 1;
    return [color[0] * factor, color[1] * factor, color[2] * factor];
  },
  flutter: 0
});

const BOX_FACES: ReadonlyArray<{ normal: Vec3; corners: Vec3[] }> = [
  { normal: [1, 0, 0], corners: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
  { normal: [-1, 0, 0], corners: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
  { normal: [0, 1, 0], corners: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
  { normal: [0, -1, 0], corners: [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]] },
  { normal: [0, 0, 1], corners: [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]] },
  { normal: [0, 0, -1], corners: [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]] }
];

const rotateYaw = (point: Vec3, yaw: number): Vec3 => {
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  return [point[0] * cos + point[2] * sin, point[1], -point[0] * sin + point[2] * cos];
};

/** Axis aligned (then yawed) box that never sways: posts, slabs, wires. Bottom face optional. */
export const addStaticBox = (
  builder: MeshBuilder, centre: Vec3, size: Vec3, style: VertexStyle, yaw = 0, bottom = false
) => {
  for (const face of BOX_FACES) {
    if (!bottom && face.normal[1] < 0) continue;
    const first = builder.vertexCount;
    const normal = rotateYaw(face.normal, yaw);
    for (const corner of face.corners) {
      const local = rotateYaw([corner[0] * size[0] / 2, corner[1] * size[1] / 2, corner[2] * size[2] / 2], yaw);
      builder.addVertex([centre[0] + local[0], centre[1] + local[1], centre[2] + local[2]], normal, style,
        undefined, STATIC_WIND);
    }
    builder.addTriangle(first, first + 1, first + 2);
    builder.addTriangle(first, first + 2, first + 3);
  }
};

export interface LatheOptions {
  centre: Vec3;
  /** [radius, height] from the bottom up; a radius of 0 closes the body there. */
  profile: ReadonlyArray<readonly [number, number]>;
  segments: number;
  /** Wind of a vertex at a profile height (static by default). */
  wind?: (height: number) => VertexWind;
  /** Ridged cross-section (a husked coconut's three faces): ridge count and depth. */
  ridges?: { count: number; depth: number };
  /** Turning axis (default up): a nut lying on its side turns about a horizontal axis. */
  axis?: Vec3;
}

/** Maps lathe-local x, y (along the axis), z into the prop space of an axis. */
const axisFrame = (axis: Vec3 | undefined) => {
  if (!axis) return (x: number, y: number, z: number): Vec3 => [x, y, z];
  const { axis: along, first, second } = getAxisFrame(axis);
  return (x: number, y: number, z: number): Vec3 => [
    first[0] * x + along[0] * y + second[0] * z, first[1] * x + along[1] * y + second[1] * z,
    first[2] * x + along[2] * y + second[2] * z
  ];
};

/** Turned body around the y axis (skeps, jars, coconuts) with smooth profile normals. */
export const addLathe = (builder: MeshBuilder, options: LatheOptions, style: VertexStyle) => {
  const { centre, profile, segments } = options;
  const first = builder.vertexCount, turn = axisFrame(options.axis);
  profile.forEach(([radius, height], ring) => {
    const previous = profile[Math.max(0, ring - 1)]!, next = profile[Math.min(profile.length - 1, ring + 1)]!;
    const slope = -(next[0] - previous[0]), rise = next[1] - previous[1];
    for (let segment = 0; segment <= segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const ridged = radius * (1 + (options.ridges ? options.ridges.depth * Math.cos(options.ridges.count * angle) : 0));
      const normal = normalize(turn(cos * rise, slope, sin * rise));
      const offset = turn(cos * ridged, height, sin * ridged);
      builder.addVertex([centre[0] + offset[0], centre[1] + offset[1], centre[2] + offset[2]], normal, style,
        undefined, options.wind?.(height) ?? STATIC_WIND);
    }
  });
  const ring = segments + 1;
  for (let index = 0; index < profile.length - 1; index += 1)
    for (let segment = 0; segment < segments; segment += 1) {
      const a = first + index * ring + segment, b = a + ring;
      builder.addTriangle(a, b, a + 1);
      builder.addTriangle(b, b + 1, a + 1);
    }
};

/** Profile of a closed egg or ball (coconuts, berries): rings between the two poles. */
export const ovoidProfile = (radius: number, height: number, rings: number, point = 0) =>
  Array.from({ length: rings + 1 }, (_, ring): readonly [number, number] => {
    const t = ring / rings, angle = t * Math.PI;
    const taper = 1 - point * t * t;
    return [Math.sin(angle) * radius * taper, (1 - Math.cos(angle)) / 2 * height];
  });

/** Coconut husk: long fibre streaks round the nut, darker towards the stalk end. */
export const huskFibres = (centre: Vec3, base: Vec3, random: Random): VertexStyle => ({
  color: ([x, y, z]) => {
    const angle = Math.atan2(z - centre[2], x - centre[0]);
    const streak = 0.84 + 0.16 * Math.abs(Math.sin(angle * 11 + (y - centre[1]) * 30));
    const factor = streak * (0.94 + random() * 0.12);
    return [base[0] * factor, base[1] * factor, base[2] * factor];
  },
  flutter: 0
});
