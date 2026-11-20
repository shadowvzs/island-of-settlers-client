import { smoothstep } from "../../../shared/world/noise";
import type { Vec3 } from "../../props/mesh-builder";
import { type AnimalModel,JOINT, PART } from "./animal-rig";

/**
 * Wapiti colour zones over the red deer texture (owner's elk brief, reference photographs):
 * a dark chocolate maned neck and head with a soft transition onto the lighter tan-grey body,
 * the darker brown belly typical of elk, legs darkening to nearly black. Each zone is a colour
 * multiplier of the texture, blended smoothly by position and surface facing, carried by the
 * vertex colours. The sharply bordered rump patch is drawn per pixel (ELK_RUMP).
 */
const ELK_ZONES = {
  belly: [0.66, 0.6, 0.58],
  head: [0.7, 0.62, 0.58],
  legs: [0.5, 0.45, 0.43],
  neck: [0.62, 0.52, 0.48],
  torso: [1.02, 1.12, 1.18]
} as const satisfies Record<string, Vec3>;

/** Wapiti winter: a paler greyer tan body (the grade), the maned neck and head darker. */
const ELK_WINTER_ZONES = {
  ...ELK_ZONES,
  head: [0.6, 0.52, 0.48],
  legs: [0.42, 0.38, 0.36],
  neck: [0.46, 0.38, 0.34]
} as const satisfies Record<keyof typeof ELK_ZONES, Vec3>;

type ElkZones = Record<keyof typeof ELK_ZONES, readonly number[]>;

const mixInto = (target: number[], color: readonly number[], weight: number) => {
  for (let channel = 0; channel < 3; channel += 1) {
    target[channel] = target[channel]! + (color[channel]! - target[channel]!) * weight;
  }
};

/** Zone tint of one rest point (position and surface up facing) from the skeleton landmarks. */
const createZoneTint = (model: AnimalModel, zones: ElkZones) => {
  const neck = model.joints[JOINT.neck]!;
  const head = model.joints[JOINT.head]!;
  const root = model.joints[JOINT.root]!;
  return (x: number, y: number, up: number) => {
    const tint: number[] = [...zones.torso];
    const belly = root[1] * 0.78;
    mixInto(tint, zones.belly, smoothstep(-0.25, -0.75, up) * smoothstep(belly * 0.7, belly, y));
    mixInto(tint, zones.legs, 1 - smoothstep(belly * 0.55, belly, y));
    mixInto(tint, zones.neck, smoothstep(neck[0] - 0.14, neck[0] + 0.04, x));
    mixInto(tint, zones.head, smoothstep(head[0] - 0.03, head[0] + 0.05, x));
    return tint;
  };
};

/**
 * The elk's rump patch in rest space (shader uniform): the x behind which the rear faces count,
 * the patch centre height, its half height and half width (an ellipse seen from behind, over
 * the buttocks and just onto the croup), from the bounds of the rear part.
 */
export const getElkRumpPatch = (model: AnimalModel) => {
  const { positions } = model.mesh;
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let vertex = 0; vertex < model.parts.length; vertex += 1) {
    if (model.parts[vertex] !== PART.rear) continue;
    for (let axis = 0; axis < 3; axis += 1) {
      low[axis] = Math.min(low[axis]!, positions[vertex * 3 + axis]!);
      high[axis] = Math.max(high[axis]!, positions[vertex * 3 + axis]!);
    }
  }
  const length = high[0]! - low[0]!;
  const height = high[1]! - low[1]!;
  return [
    low[0]! + length * 0.4,
    low[1]! + height * 0.52,
    height * 0.4,
    high[2]! * 0.92
  ] as const;
};

/**
 * Red deer coat over the source texture (summer hind, reference photographs): the source is an
 * even orange red. Multipliers of the texture: a darker back with a dark dorsal line, buff belly
 * and inner flanks, a cooler, greyer neck, a pale muzzle, chin and throat with a dark moist nose,
 * grey-brown lower legs with near-black hooves and the pale rump patch around the tail.
 */
const DEER_SUMMER_ZONES = {
  back: [0.74, 0.7, 0.7],
  belly: [1.2, 1.18, 1.1],
  chin: [1.3, 1.27, 1.2],
  dorsal: [0.8, 0.76, 0.76],
  hoof: [0.38, 0.35, 0.34],
  legs: [0.86, 0.84, 0.86],
  muzzle: [1.16, 1.12, 1.08],
  neck: [0.88, 0.86, 0.9],
  nose: [0.3, 0.28, 0.28],
  rump: [1.4, 1.36, 1.24],
  torso: [0.93, 0.94, 0.98]
} as const satisfies Record<string, Vec3>;

/**
 * Red deer winter (with the grey winter grade): the thick coat shows little contrast, a lighter
 * back and darker belly than in summer, and a duller rump patch.
 */
const DEER_WINTER_ZONES = {
  ...DEER_SUMMER_ZONES,
  back: [0.88, 0.86, 0.86],
  belly: [1.08, 1.06, 1.04],
  dorsal: [0.92, 0.9, 0.9],
  rump: [1.18, 1.15, 1.1]
} as const satisfies Record<keyof typeof DEER_SUMMER_ZONES, Vec3>;
type DeerZones = Record<keyof typeof DEER_SUMMER_ZONES, readonly number[]>;

const TRUNK_PARTS = new Set<number>([PART.body, PART.rear, PART.neck]);
const LOWER_LEG_PARTS = new Set<number>([
  PART.frontLeftLower,
  PART.frontRightLower,
  PART.hindLeftLower,
  PART.hindRightLower
]);

/** A rest point of the deer: position, normal and body part. */
interface CoatPoint {
  normal: readonly number[];
  part: number;
  position: readonly number[];
}

/** Back, dorsal line and belly of the trunk and neck, by the surface facing. */
const addTrunkShading = (tint: number[], point: CoatPoint, zones: DeerZones) => {
  if (!TRUNK_PARTS.has(point.part)) return;
  const up = point.normal[1]!;
  mixInto(tint, zones.back, smoothstep(0.35, 0.9, up));
  mixInto(tint, zones.dorsal, smoothstep(0.85, 0.98, up) * 0.6);
  mixInto(tint, zones.belly, smoothstep(-0.25, -0.75, up));
};

/** Muzzle, nose and chin of the head (forward of the eyes), the throat below the jaw. */
const addFaceMarkings = (
  tint: number[],
  point: CoatPoint,
  zones: DeerZones,
  head: Vec3,
  snout: number
) => {
  if (point.part !== PART.head) return;
  const [x, y] = point.position;
  const forward = smoothstep(head[0] + snout * 0.45, head[0] + snout * 0.75, x!);
  mixInto(tint, zones.muzzle, forward);
  mixInto(tint, zones.nose, smoothstep(head[0] + snout * 0.9, head[0] + snout * 0.98, x!));
  const under = smoothstep(-0.2, -0.7, point.normal[1]!) * smoothstep(head[1] + 0.01, head[1] - 0.03, y!);
  mixInto(tint, zones.chin, under);
};

/** Zone tint of one rest point of the deer. */
const createDeerTint = (model: AnimalModel, zones: DeerZones) => {
  const neck = model.joints[JOINT.neck]!;
  const head = model.joints[JOINT.head]!;
  const hind = model.joints[JOINT.hindLeftHip]!;
  const knee = model.joints[JOINT.frontLeftKnee]![1];
  let snout = 0;
  for (let vertex = 0; vertex < model.parts.length; vertex += 1) {
    if (model.parts[vertex] !== PART.head) continue;
    snout = Math.max(snout, model.mesh.positions[vertex * 3]! - head[0]);
  }
  return (point: CoatPoint) => {
    const [x, y] = point.position as [number, number];
    const tint: number[] = [...zones.torso];
    addTrunkShading(tint, point, zones);
    mixInto(tint, zones.neck, smoothstep(neck[0] - 0.05, neck[0] + 0.06, x) * 0.8);
    const lowerLeg = LOWER_LEG_PARTS.has(point.part) ? 1 : 0;
    mixInto(tint, zones.legs, Math.max(lowerLeg, 1 - smoothstep(knee * 0.9, knee * 1.4, y)));
    mixInto(tint, zones.hoof, 1 - smoothstep(0.02, 0.045, y));
    const behind = smoothstep(hind[0] - 0.04, hind[0] - 0.14, x);
    mixInto(tint, zones.rump, behind * smoothstep(-0.1, -0.6, point.normal[0]!));
    addFaceMarkings(tint, point, zones, head, snout);
    return tint;
  };
};

/** Red deer coat zones (summer or winter) multiplied into the vertex colours (not eyes, antlers). */
export const addDeerZones = (model: AnimalModel, winter: boolean): AnimalModel => {
  const { normals, positions, uvs } = model.mesh;
  const colors = Float32Array.from(model.mesh.colors);
  const tintAt = createDeerTint(model, winter ? DEER_WINTER_ZONES : DEER_SUMMER_ZONES);
  for (let vertex = 0; vertex < model.parts.length; vertex += 1) {
    if (uvs[vertex * 2]! < 0 || model.fur[vertex * 4 + 3] === 0) continue;
    const at = vertex * 3;
    const tint = tintAt({
      normal: [normals[at]!, normals[at + 1]!, normals[at + 2]!],
      part: model.parts[vertex]!,
      position: [positions[at]!, positions[at + 1]!, positions[at + 2]!]
    });
    for (let channel = 0; channel < 3; channel += 1) colors[at + channel]! *= tint[channel]!;
  }
  return { ...model, mesh: { ...model.mesh, colors } };
};

/** Antler colour over the shared antler texture: warmer bone and brown, less olive. */
const ANTLER_TINT = [1.02, 0.98, 0.92] as const;

/** The antler tint multiplied into the antler vertices (deer and elk). */
export const addAntlerTint = (model: AnimalModel): AnimalModel => {
  const colors = Float32Array.from(model.mesh.colors);
  for (let vertex = 0; vertex < model.parts.length; vertex += 1) {
    if (model.parts[vertex] !== PART.antler) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      colors[vertex * 3 + channel]! *= ANTLER_TINT[channel]!;
    }
  }
  return { ...model, mesh: { ...model.mesh, colors } };
};

/** The elk's zones (summer or winter) multiplied into the vertex colours (not eyes, antlers). */
export const addElkZones = (model: AnimalModel, winter: boolean): AnimalModel => {
  const { normals, positions, uvs } = model.mesh;
  const colors = Float32Array.from(model.mesh.colors);
  const tintAt = createZoneTint(model, winter ? ELK_WINTER_ZONES : ELK_ZONES);
  for (let vertex = 0; vertex < model.parts.length; vertex += 1) {
    if (uvs[vertex * 2]! < 0 || model.fur[vertex * 4 + 3] === 0) continue;
    const at = vertex * 3;
    const tint = tintAt(positions[at]!, positions[at + 1]!, normals[at + 1]!);
    for (let channel = 0; channel < 3; channel += 1)
      colors[vertex * 3 + channel]! *= tint[channel]!;
  }
  return { ...model, mesh: { ...model.mesh, colors } };
};
