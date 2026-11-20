import { Vector3 } from "three";

import { speckle } from "../../src/render-common/critters/model/critter-builder";
import type { Vec3 } from "../../src/render-common/props/mesh-builder";
import { lerp3, smoothstep } from "../../src/shared/world/noise";
import { getBonePosition, skinPose,type SkinSource } from "./gltf-skin-sampler";

/**
 * Chamois anatomy and coat over the antelope source ("Antelope" by planeta-elefante, CC BY 4.0),
 * in the source's bind space (y up, facing +z): an offline step of chamois-model.ts.
 * Chamois (Rupicapra rupicapra) against the slender antelope: a stockier trunk, a thicker neck,
 * sturdier legs, a shorter muzzle, a short tail and short black horns rising straight from the
 * forehead and hooked sharply back at the tip.
 */

const BONES = {
  head: "Bip01 Head_025",
  neck: "Bip01 Neck_020",
  neck1: "Bip01 Neck1_024",
  tail: "Bip01 Tail_035"
} as const;
const BODY_BONES = ["Pelvis", "Spine_05", "Spine1", "Spine2", "Clavicle"];
const NECK_BONES = ["Neck_020", "Neck1"];
const HEAD_BONES = ["Head_025", "HeadNub"];
const EAR_BONES = ["Ponytail"];
const TAIL_BONES = ["Tail"];
const LEG_BONES = ["Thigh", "Calf", "HorseLink", "Foot", "Toe", "UpperArm", "Forearm", "Hand"];

/** Height of the trunk's centre line in the source (between back and belly). */
const TRUNK_CENTRE = 0.92;

export type Group = "body" | "neck" | "head" | "ear" | "tail" | "leg" | "horn";

/** Joint names of the skin, by joint index. */
const getJointNames = (source: SkinSource) => {
  const json = source.file.json as any;
  return (json.skins[0].joints as number[]).map((node) => json.nodes[node].name as string);
};

/** Summed skin weight of the vertex on joints whose name contains one of `parts`. */
const weightOf = (source: SkinSource, names: string[], vertex: number, parts: string[]) => {
  let sum = 0;
  for (let influence = 0; influence < 4; influence += 1) {
    const name = names[source.joints[vertex * 4 + influence]!]!;
    if (parts.some((part) => name.includes(part))) sum += source.weights[vertex * 4 + influence]!;
  }
  return sum;
};

const dominantName = (source: SkinSource, names: string[], vertex: number) => {
  let best = 0;
  for (let influence = 1; influence < 4; influence += 1) {
    if (source.weights[vertex * 4 + influence]! > source.weights[vertex * 4 + best]!) best = influence;
  }
  return names[source.joints[vertex * 4 + best]!]!;
};

const point = (source: SkinSource, vertex: number) => new Vector3().fromArray(source.positions, vertex * 3);

/** Which body region each vertex belongs to (its dominant bone; horns above the skull). */
export const classifyVertices = (source: SkinSource): Group[] => {
  const names = getJointNames(source);
  const count = source.positions.length / 3;
  return Array.from({ length: count }, (_, vertex): Group => {
    const name = dominantName(source, names, vertex);
    const p = point(source, vertex);
    if (HEAD_BONES.some((bone) => name.includes(bone))) return p.y > 1.335 ? "horn" : "head";
    if (EAR_BONES.some((bone) => name.includes(bone))) return "ear";
    if (NECK_BONES.some((bone) => name.includes(bone))) return "neck";
    if (TAIL_BONES.some((bone) => name.includes(bone))) return "tail";
    if (LEG_BONES.some((bone) => name.includes(bone))) return "leg";
    return "body";
  });
};

/** Moves `p` away from the line a→b by `factor` (perpendicular part only). */
const thicken = (p: Vector3, a: Vector3, b: Vector3, factor: number) => {
  const axis = b.clone().sub(a).normalize();
  const along = a.clone().add(axis.clone().multiplyScalar(p.clone().sub(a).dot(axis)));
  return along.add(p.clone().sub(along).multiplyScalar(factor));
};

/**
 * Chamois horns from the antelope horn vertices: the long lyre horns become short horns rising
 * straight from the forehead (nearly parallel, tilted a little back) that hook sharply back
 * and down at the tip, thinner towards it.
 */
const reshapeHorns = (source: SkinSource, groups: Group[]) => {
  for (const sign of [1, -1]) {
    const horn = groups.flatMap((group, vertex) =>
      group === "horn" && Math.sign(source.positions[vertex * 3]!) === sign ? [vertex] : []
    );
    const ys = horn.map((vertex) => source.positions[vertex * 3 + 1]!);
    const [baseY, topY] = [Math.min(...ys), Math.max(...ys)];
    const centreAt = (y: number) => {
      const band = horn.filter((vertex) => Math.abs(source.positions[vertex * 3 + 1]! - y) < 0.02);
      const centre = new Vector3();
      for (const vertex of band) centre.add(point(source, vertex));
      return centre.multiplyScalar(1 / Math.max(1, band.length));
    };
    const base = centreAt(baseY + 0.01);
    base.x *= 0.8;
    const up = new Vector3(0, 1, -0.22).normalize();
    const back = new Vector3(0, -0.3, -1).normalize();
    const [length, straight, radius] = [0.2, 0.13, 0.035];
    for (const vertex of horn) {
      const p = point(source, vertex);
      const t = (p.y - baseY) / (topY - baseY);
      const offset = p.clone().sub(centreAt(p.y)).multiplyScalar(0.8 * (1 - 0.6 * t));
      const s = t * length;
      const bend = Math.max(0, s - straight) / radius;
      const centre = base.clone().addScaledVector(up, Math.min(s, straight));
      centre.addScaledVector(up, radius * Math.sin(bend)).addScaledVector(back, radius * (1 - Math.cos(bend)));
      centre.add(offset).toArray(source.positions, vertex * 3);
    }
  }
};

/** Stockier trunk, thicker neck and legs, shorter muzzle and tail (bind space, in place). */
export const reshapeToChamois = (source: SkinSource, groups: Group[]) => {
  const names = getJointNames(source);
  const bind = skinPose(source, null, 0).world;
  const bone = (name: string) => getBonePosition(source, bind, name);
  const [head, neck, neck1, tail] = [bone(BONES.head), bone(BONES.neck), bone(BONES.neck1), bone(BONES.tail)];
  const count = source.positions.length / 3;
  for (let vertex = 0; vertex < count; vertex += 1) {
    if (groups[vertex] === "horn") continue;
    let p = point(source, vertex);
    const trunk = weightOf(source, names, vertex, BODY_BONES);
    p.x *= 1 + 0.16 * trunk;
    // A deeper chest and belly (the legs read shorter, the build stockier).
    if (p.y < TRUNK_CENTRE) p.y -= (TRUNK_CENTRE - p.y) * 0.22 * trunk;
    p = thicken(p, neck, head, 1 + 0.32 * weightOf(source, names, vertex, NECK_BONES));
    if (groups[vertex] === "leg") p.x += Math.sign(p.x) * 0.012;
    const muzzle = smoothstep(head.z + 0.03, head.z + 0.12, p.z) * weightOf(source, names, vertex, HEAD_BONES);
    p.z -= (p.z - head.z - 0.03) * 0.16 * muzzle;
    const tailShare = weightOf(source, names, vertex, TAIL_BONES);
    p.lerp(tail, 0.45 * tailShare);
    p.toArray(source.positions, vertex * 3);
  }
  reshapeHorns(source, groups);
  return { head, neck: neck1 };
};

const SUMMER = {
  belly: [0.72, 0.58, 0.4],
  coat: [0.56, 0.38, 0.21],
  dark: [0.14, 0.1, 0.08],
  face: [0.9, 0.86, 0.76],
  hoof: [0.08, 0.07, 0.06],
  horn: [0.06, 0.05, 0.05],
  rump: [0.78, 0.66, 0.5]
} as const satisfies Record<string, Vec3>;
const WINTER = {
  ...SUMMER,
  belly: [0.3, 0.25, 0.21],
  coat: [0.14, 0.11, 0.09],
  dark: [0.07, 0.06, 0.05],
  rump: [0.68, 0.62, 0.52]
} as const satisfies Record<keyof typeof SUMMER, Vec3>;
type Palette = Record<keyof typeof SUMMER, readonly number[]>;

/** The dark band from the horn base over the eye to the corner of the mouth (head space). */
const isFaceBand = (forward: number, up: number, side: number) =>
  side > 0.028 && Math.abs(up - (0.16 - 0.82 * forward)) < 0.032 && forward > -0.02;

const rgb = (color: readonly number[]): Vec3 => [color[0]!, color[1]!, color[2]!];

const paintVertex = (palette: Palette, group: Group, p: Vector3, normal: Vector3, head: Vector3): Vec3 => {
  if (group === "horn") return rgb(palette.horn);
  const forward = p.z - head.z;
  const up = p.y - head.y;
  const side = Math.abs(p.x);
  if (group === "head") {
    if (forward > 0.21) return rgb(palette.dark);
    return rgb(isFaceBand(forward, up, side) ? palette.dark : palette.face);
  }
  if (group === "ear") return rgb(p.y > 1.42 ? palette.dark : palette.coat);
  if (group === "tail") return rgb(palette.dark);
  if (group === "leg") {
    if (p.y < 0.1) return rgb(palette.hoof);
    return lerp3(rgb(palette.coat), rgb(palette.dark), 1 - smoothstep(0.25, 0.6, p.y));
  }
  if (group === "neck" && normal.y < -0.25 && p.y > 1.05) return rgb(palette.face);
  const stripe = side < 0.04 && normal.y > 0.75 ? 0.85 : 0;
  const belly = smoothstep(-0.3, -0.7, normal.y);
  const rump = smoothstep(-0.48, -0.6, p.z) * smoothstep(-0.2, -0.6, normal.z);
  let color = lerp3(rgb(palette.coat), rgb(palette.belly), belly);
  color = lerp3(color, rgb(palette.rump), rump);
  return lerp3(color, rgb(palette.dark), stripe);
};

/** Summer and winter vertex colours (rgb triples, 0..1) from the bind-space shape. */
export const paintCoats = (source: SkinSource, groups: Group[], head: Vector3) => {
  const count = source.positions.length / 3;
  const bind = skinPose(source, null, 0);
  const summer = new Float32Array(count * 3);
  const winter = new Float32Array(count * 3);
  for (let vertex = 0; vertex < count; vertex += 1) {
    const p = new Vector3().fromArray(bind.positions, vertex * 3);
    const normal = new Vector3().fromArray(bind.normals, vertex * 3);
    const mottle = 1 + speckle(p.x * 50, p.y * 50, p.z * 50) * 0.08;
    const a = paintVertex(SUMMER, groups[vertex]!, p, normal, head).map((c) => c * mottle);
    const b = paintVertex(WINTER, groups[vertex]!, p, normal, head).map((c) => c * mottle);
    summer.set(a, vertex * 3);
    winter.set(b, vertex * 3);
  }
  return { summer, winter };
};
