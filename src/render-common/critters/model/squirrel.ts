import { lerp3, smoothstep } from "../../../shared/world/noise";
import type { PropMesh, Vec3 } from "../../props/mesh-builder";
import { CRITTER_GLB } from "./critter-glbs";
import { CLIP, createClips, type CritterModel,cycle, pose } from "./critter-model";
import {
  copyMesh,
  readCritterMesh,
  recolor,
  refreshBounds,
  turnRegion,
  weighAll,
  weighRegion
} from "./critter-pose";

/**
 * Squirrel from the shipped model (assets/models/critters/squirrel: iRahulRajput, CC-BY-4.0,
 * built by ../island-of-settlers-asset-tools/src/build-critter.ts), posed procedurally: looking around, two hop frames,
 * nibbling, sitting up, and clinging to a trunk head up or head down (the belly towards the
 * tree, which is in front of it).
 */
const NECK: Vec3 = [0.06, 0.08, 0];
/** Body turns (hops, sitting up, clinging) pivot at the belly. */
const BELLY: Vec3 = [0, 0.05, 0];
/** Tail root: the tail swings up while sitting and looking. */
const TAIL_ROOT: Vec3 = [-0.06, 0.04, 0];
const UP: Vec3 = [0, 1, 0];
const SIDE: Vec3 = [0, 0, 1];
const CLING = 1.45;

const SQUIRREL_FRAME = {
  stand: 0,
  lookLeft: 1,
  lookRight: 2,
  hopStretch: 3,
  hopTuck: 4,
  nibble: 5,
  sitUp: 6,
  climbDown: 7,
  climbUp: 8
} as const;

interface SquirrelPose {
  body: number;
  headPitch: number;
  headYaw: number;
  tail: number;
}

const POSES: readonly SquirrelPose[] = [
  { body: 0, headPitch: 0, headYaw: 0, tail: 0 },
  { body: 0, headPitch: 0.1, headYaw: 0.8, tail: 0.2 },
  { body: 0, headPitch: 0.1, headYaw: -0.8, tail: 0.2 },
  { body: -0.22, headPitch: 0.1, headYaw: 0, tail: -0.25 },
  { body: 0.18, headPitch: -0.1, headYaw: 0, tail: 0.3 },
  { body: -0.08, headPitch: -0.55, headYaw: 0, tail: 0.1 },
  { body: 0.75, headPitch: -0.35, headYaw: 0, tail: 0.15 },
  { body: -CLING, headPitch: 0.25, headYaw: 0, tail: 0.4 },
  { body: CLING, headPitch: -0.25, headYaw: 0, tail: -0.2 }
];

const isHead = (point: Vec3) =>
  smoothstep(0.035, 0.085, point[0]) * smoothstep(0.05, 0.08, point[1]);
const isTail = (point: Vec3) => smoothstep(-0.05, -0.09, point[0]);

const createPose = (
  base: PropMesh,
  regions: { head: Float32Array; tail: Float32Array },
  values: SquirrelPose
) => {
  const mesh = copyMesh(base);
  turnRegion(mesh, regions.tail, TAIL_ROOT, SIDE, values.tail);
  turnRegion(mesh, regions.head, NECK, UP, values.headYaw);
  turnRegion(mesh, regions.head, NECK, SIDE, values.headPitch);
  turnRegion(mesh, weighAll(mesh), BELLY, SIDE, values.body);
  return refreshBounds(mesh);
};

const CLIPS = createClips({
  [CLIP.idle]: pose(SQUIRREL_FRAME.stand),
  [CLIP.look]: pose(SQUIRREL_FRAME.lookLeft, SQUIRREL_FRAME.stand, SQUIRREL_FRAME.lookRight),
  [CLIP.move]: cycle(SQUIRREL_FRAME.hopStretch, SQUIRREL_FRAME.hopTuck),
  [CLIP.fast]: cycle(SQUIRREL_FRAME.hopStretch, SQUIRREL_FRAME.hopTuck),
  [CLIP.feed]: pose(SQUIRREL_FRAME.stand, SQUIRREL_FRAME.nibble),
  [CLIP.rest]: pose(SQUIRREL_FRAME.stand, SQUIRREL_FRAME.sitUp),
  [CLIP.air]: pose(SQUIRREL_FRAME.climbDown, SQUIRREL_FRAME.stand, SQUIRREL_FRAME.climbUp)
});

const CREAM: Vec3 = [0.86, 0.8, 0.68];

/** The belly and throat pale (lost in the baked texture's blur). */
const paintBelly = (normals: Float32Array) => (color: Vec3, point: Vec3, vertex: number) => {
  const down = -normals[vertex * 3 + 1]!;
  const belly = smoothstep(0.3, 0.8, down) * smoothstep(0.07, 0.03, point[1]);
  return lerp3(color, CREAM, belly * 0.75);
};

export const createSquirrelModel = (): CritterModel => {
  const source = readCritterMesh(CRITTER_GLB.squirrel);
  const base = recolor(copyMesh(source), paintBelly(source.normals));
  const regions = { head: weighRegion(base, isHead), tail: weighRegion(base, isTail) };
  return { clips: CLIPS, frames: POSES.map((values) => createPose(base, regions, values)) };
};
