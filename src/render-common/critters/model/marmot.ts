import { lerp3, smoothstep } from "../../../shared/world/noise";
import type { PropMesh, Vec3 } from "../../props/mesh-builder";
import { CritterBuilder, speckle } from "./critter-builder";
import { CLIP, createClips, type CritterModel,cycle, pose } from "./critter-model";
import {
  copyMesh,
  moveAll,
  refreshBounds,
  sinkIntoHole,
  turnRegion,
  weighRegion
} from "./critter-pose";
import { createQuadrupedFrames, QUAD_FRAME } from "./quadruped-models";
import { MARMOT_SHAPE } from "./quadruped-mountain";

/** The quadruped frames, then sitting up (ahead, left, right) and half / deep in the hole. */
export const MARMOT_FRAME = {
  ...QUAD_FRAME,
  sitUp: 13,
  sitLeft: 14,
  sitRight: 15,
  half: 16,
  deep: 17
} as const;

const SIDE: Vec3 = [0, 0, 1];
const UP: Vec3 = [0, 1, 0];
/** Sitting up: the front body turns up about the hind hips, the head levels again. */
const SIT_ANGLE = 1.2;
const HEAD_LEVEL = -1.05;
const LOOK = 0.8;
/** Share of the body in the hole mouth: the sunk part narrows to this. */
const MOUTH = 0.35;

const { bodyHeight, bodyLength, legLength } = MARMOT_SHAPE;
const HIP: Vec3 = [-0.3 * bodyLength, legLength + bodyHeight * 0.7, 0];
const NECK: Vec3 = [0.42 * bodyLength, legLength + bodyHeight * 1.4, 0];

const isFront = (point: Vec3) => smoothstep(HIP[0] - 0.02, HIP[0] + 0.07, point[0]);
const isHead = (point: Vec3) => smoothstep(NECK[0] - 0.01, NECK[0] + 0.02, point[0]);

const sitUp = (stand: PropMesh, yaw: number) => {
  const mesh = copyMesh(stand);
  const head = weighRegion(stand, isHead);
  turnRegion(mesh, head, NECK, UP, yaw);
  turnRegion(mesh, head, NECK, SIDE, HEAD_LEVEL);
  turnRegion(mesh, weighRegion(stand, isFront), HIP, SIDE, SIT_ANGLE);
  return refreshBounds(mesh);
};

/** The sitting marmot sunk by `depth` of its height into its hole. */
const sink = (sitting: PropMesh, depth: number) =>
  refreshBounds(
    sinkIntoHole(moveAll(copyMesh(sitting), [0, -sitting.height * depth, 0]), 0, MOUTH)
  );

const CLIPS = createClips({
  [CLIP.idle]: pose(MARMOT_FRAME.stand),
  [CLIP.move]: cycle(
    MARMOT_FRAME.trot,
    MARMOT_FRAME.trot + 1,
    MARMOT_FRAME.trot + 2,
    MARMOT_FRAME.trot + 3
  ),
  [CLIP.fast]: cycle(
    MARMOT_FRAME.trot,
    MARMOT_FRAME.trot + 1,
    MARMOT_FRAME.trot + 2,
    MARMOT_FRAME.trot + 3
  ),
  [CLIP.feed]: pose(MARMOT_FRAME.stand, MARMOT_FRAME.reach),
  /** Sentinel: sitting up, the pose turns the head left (0) .. ahead (0.5) .. right (1). */
  [CLIP.look]: pose(MARMOT_FRAME.sitLeft, MARMOT_FRAME.sitUp, MARMOT_FRAME.sitRight),
  [CLIP.rest]: pose(MARMOT_FRAME.stand, MARMOT_FRAME.rest),
  /** Coming out of (0 .. 1) or diving into (1 .. 0) the hole. */
  [CLIP.air]: pose(MARMOT_FRAME.deep, MARMOT_FRAME.half, MARMOT_FRAME.sitUp)
});

/** Alpine marmot: the procedural quadruped plus sitting up and slipping into its burrow. */
export const createMarmotModel = (): CritterModel => {
  const frames = createQuadrupedFrames(MARMOT_SHAPE);
  const stand = frames[MARMOT_FRAME.stand]!;
  const sitting = sitUp(stand, 0);
  frames.push(
    sitting,
    sitUp(stand, LOOK),
    sitUp(stand, -LOOK),
    sink(sitting, 0.55),
    sink(sitting, 1)
  );
  return { clips: CLIPS, frames };
};

const EARTH: Vec3 = [0.4, 0.3, 0.2];
const STONE: Vec3 = [0.56, 0.53, 0.48];
const HOLE: Vec3 = [0.05, 0.04, 0.035];
/** Mound profile from the hole rim outwards: radius and height (world units). */
const MOUND: readonly (readonly [number, number])[] = [
  [0.045, -0.004],
  [0.06, 0.024],
  [0.095, 0.034],
  [0.15, 0.016],
  [0.2, -0.004]
];
const MOUND_SIDES = 14;
/** The spoil heap runs out downhill in front of the hole (stretched along +x). */
const SPOIL_STRETCH = 0.45;

const getMoundColor = (angle: number, ring: number): Vec3 => {
  const grit = speckle(angle * 7, ring * 3, 1.3);
  return lerp3(EARTH, STONE, Math.max(0, grit) * 0.6);
};

/** A burrow: the dark hole in a low ring of dug out earth and stones (one static frame). */
export const createBurrowModel = (): CritterModel => {
  const builder = new CritterBuilder();
  const centre = builder.vertex([0, -0.01, 0], HOLE);
  const rings = MOUND.map(([radius, height], ring) =>
    Array.from({ length: MOUND_SIDES }, (_, side) => {
      const angle = (side / MOUND_SIDES) * Math.PI * 2;
      const stretch = 1 + SPOIL_STRETCH * Math.max(0, Math.cos(angle)) * (ring / MOUND.length);
      const point: Vec3 = [Math.cos(angle) * radius * stretch, height, Math.sin(angle) * radius];
      return builder.vertex(point, ring === 0 ? HOLE : getMoundColor(angle, ring));
    })
  );
  for (let side = 0; side < MOUND_SIDES; side += 1) {
    const next = (side + 1) % MOUND_SIDES;
    builder.triangle(centre, rings[0]![side]!, rings[0]![next]!, UP);
    for (let ring = 0; ring < rings.length - 1; ring += 1) {
      const [inner, outer] = [rings[ring]!, rings[ring + 1]!];
      builder.quad(inner[side]!, inner[next]!, outer[next]!, outer[side]!, UP);
    }
  }
  const mesh = builder.finish();
  return { clips: createClips({ [CLIP.idle]: pose(0) }), frames: [mesh] };
};
