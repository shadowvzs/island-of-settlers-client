import { lerp3, smoothstep } from "../../../shared/world/noise";
import type { PropMesh, Vec3 } from "../../props/mesh-builder";
import { speckle } from "./critter-builder";
import { CRITTER_GLB } from "./critter-glbs";
import { CLIP, createClips, type CritterModel,cycle, pose } from "./critter-model";
import {
  copyMesh,
  flattenBelow,
  moveAll,
  readCritterMesh,
  recolor,
  refreshBounds,
  scaleMesh,
  turnRegion,
  weighAll,
  weighRegion
} from "./critter-pose";

/**
 * Mallards from the shipped model (assets/models/critters/mallard: 3Dima, CC-BY-4.0, built by
 * ../island-of-settlers-asset-tools/src/build-critter.ts). Swimming poses: the body floats with its water line at y 0
 * (legs and hull flattened under it), the head turns, dips its bill and tips up to dabble, or
 * lies on the back asleep. The hen and the ducklings are the drake recoloured (and scaled).
 */

/** Height of the water line on the standing model, and the neck joint. */
const WATER_LINE = 0.11;
const NECK: Vec3 = [0.09, 0.19, 0];
/** The body tips up about a point just in front of the middle, at the water line. */
const TIP_PIVOT: Vec3 = [0.02, WATER_LINE, 0];
const UP: Vec3 = [0, 1, 0];
const SIDE: Vec3 = [0, 0, 1];
/** Flattened hull a hair under the surface (hidden by the water, never z-fighting it). */
const HULL = -0.004;

const MALLARD_FRAME = {
  swim: 0,
  stretch: 1,
  lookLeft: 2,
  lookRight: 3,
  dip: 4,
  dabble: 5,
  sleep: 6
} as const;

const isHead = (point: Vec3) => smoothstep(0.03, 0.09, point[0]) * smoothstep(0.15, 0.21, point[1]);

interface MallardPose {
  /** Head pitch (radians, negative dips the bill). */
  headPitch: number;
  /** Head turn (radians, positive to the left). */
  headYaw: number;
  /** Body tip forward (radians: tail up, head under). */
  tip: number;
}

const createPose = (base: PropMesh, head: Float32Array, values: MallardPose) => {
  const mesh = copyMesh(base);
  turnRegion(mesh, head, NECK, UP, values.headYaw);
  turnRegion(mesh, head, NECK, SIDE, values.headPitch);
  turnRegion(mesh, weighAll(mesh), TIP_PIVOT, SIDE, -values.tip);
  moveAll(mesh, [0, -WATER_LINE, 0]);
  return refreshBounds(flattenBelow(mesh, HULL));
};

const POSES: readonly MallardPose[] = [
  { headPitch: 0, headYaw: 0, tip: 0 },
  { headPitch: -0.14, headYaw: 0, tip: 0.03 },
  { headPitch: 0, headYaw: 0.75, tip: 0 },
  { headPitch: 0, headYaw: -0.75, tip: 0 },
  { headPitch: -0.75, headYaw: 0, tip: 0.18 },
  { headPitch: -0.3, headYaw: 0, tip: 1.05 },
  { headPitch: 0.6, headYaw: 2.7, tip: 0 }
];

const CLIPS = createClips({
  [CLIP.idle]: cycle(MALLARD_FRAME.swim, MALLARD_FRAME.swim, MALLARD_FRAME.stretch),
  [CLIP.move]: cycle(MALLARD_FRAME.swim, MALLARD_FRAME.stretch),
  [CLIP.fast]: cycle(MALLARD_FRAME.stretch, MALLARD_FRAME.swim),
  [CLIP.feed]: pose(MALLARD_FRAME.swim, MALLARD_FRAME.dip, MALLARD_FRAME.dabble),
  [CLIP.look]: pose(MALLARD_FRAME.lookLeft, MALLARD_FRAME.swim, MALLARD_FRAME.lookRight),
  [CLIP.rest]: pose(MALLARD_FRAME.swim, MALLARD_FRAME.sleep)
});

const HEN_BROWN: Vec3 = [0.58, 0.45, 0.3];
const HEN_DARK: Vec3 = [0.24, 0.16, 0.1];
const HEN_BILL: Vec3 = [0.62, 0.42, 0.18];
const DUCKLING_DOWN: Vec3 = [0.84, 0.74, 0.42];
const DUCKLING_BACK: Vec3 = [0.3, 0.23, 0.14];

const isBill = (point: Vec3) => point[0] > 0.15 && point[1] > 0.2;
/** The blue wing patch (speculum) stays on the hen. */
const isSpeculum = (color: Vec3) => color[2] > color[0] * 1.25 && color[2] > 0.18;

/** Mottled brown hen: dark feather centres, a darker crown and back, an orange-brown bill. */
const paintHen = (color: Vec3, point: Vec3): Vec3 => {
  if (isBill(point)) return HEN_BILL;
  if (isSpeculum(color) && isHead(point) < 0.5) return color;
  const mottle = speckle(point[0] * 40, point[1] * 40, point[2] * 40);
  const back = smoothstep(0.17, 0.21, point[1]) * (1 - isHead(point));
  const crown = isHead(point) * smoothstep(0.26, 0.29, point[1]);
  const darkness = Math.max(0, mottle) * 0.7 + back * 0.3 + crown * 0.65;
  return lerp3(HEN_BROWN, HEN_DARK, Math.min(1, darkness));
};

/** Downy duckling: dark back and crown, yellow face, breast and flanks. */
const paintDuckling = (normals: Float32Array) => (_: Vec3, point: Vec3, vertex: number) => {
  if (isBill(point)) return HEN_DARK;
  const facingUp = normals[vertex * 3 + 1]!;
  const crown = isHead(point) * smoothstep(0.26, 0.28, point[1]);
  const back = smoothstep(0.35, 0.75, facingUp) * (1 - isHead(point));
  return lerp3(DUCKLING_DOWN, DUCKLING_BACK, Math.min(1, back + crown));
};

/** Ducklings: the hen's shape scaled down. */
const DUCKLING_SCALE = 0.42;

const createModel = (base: PropMesh): CritterModel => {
  const head = weighRegion(base, isHead);
  return { clips: CLIPS, frames: POSES.map((values) => createPose(base, head, values)) };
};

/** A posed model scaled as a whole (posed first: the regions and pivots fit the adult). */
const scaleModel = (model: CritterModel, factor: number): CritterModel => ({
  ...model,
  frames: model.frames.map((frame) => scaleMesh(frame, factor))
});

export const createMallardModels = () => {
  const drake = readCritterMesh(CRITTER_GLB.mallard);
  const hen = recolor(copyMesh(drake), paintHen);
  const duckling = recolor(copyMesh(drake), paintDuckling(drake.normals));
  return {
    drake: createModel(drake),
    duckling: scaleModel(createModel(duckling), DUCKLING_SCALE),
    hen: createModel(hen)
  };
};
