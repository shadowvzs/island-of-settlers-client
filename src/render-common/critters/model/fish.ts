import { lerp3 } from "../../../shared/world/noise";
import type { PropMesh, Vec3 } from "../../props/mesh-builder";
import { CritterBuilder, type LoftStation,pitchAbout, speckle } from "./critter-builder";
import { CLIP, createClips, type CritterModel,pose } from "./critter-model";

/**
 * Original procedural fish leaping out of the water: a spindle body with a forked tail, a
 * dorsal fin and countershaded, spotted or barred colours. Frames are pitched from nose down to
 * nose up (the leap's arc) with the tail flexing alternately; the `air` clip blends them by
 * the pitch (amount 0 = nose down .. 1 = nose up).
 */
export interface FishLook {
  back: Vec3;
  belly: Vec3;
  /** Lateral band (the trout's pink stripe) or the side colour again. */
  band: Vec3;
  /** Dark back markings: spots (trout) or wavy bars (mackerel). */
  markings: "spots" | "bars";
  length: number;
  side: Vec3;
}

export const RIVER_TROUT: FishLook = {
  back: [0.3, 0.33, 0.24],
  band: [0.78, 0.5, 0.5],
  belly: [0.9, 0.88, 0.82],
  length: 0.26,
  markings: "spots",
  side: [0.72, 0.72, 0.66]
};

export const SEA_MACKEREL: FishLook = {
  back: [0.14, 0.34, 0.38],
  band: [0.7, 0.76, 0.78],
  belly: [0.92, 0.93, 0.92],
  length: 0.28,
  markings: "bars",
  side: [0.62, 0.7, 0.72]
};

/** Body stations: x share of the length, half height share, half width share. */
const BODY: readonly (readonly [number, number, number])[] = [
  [-0.4, 0.035, 0.02],
  [-0.3, 0.07, 0.035],
  [-0.15, 0.115, 0.055],
  [0.02, 0.135, 0.065],
  [0.2, 0.12, 0.06],
  [0.34, 0.085, 0.048],
  [0.44, 0.04, 0.03]
];
const FISH_PITCHES = [-1.05, -0.5, 0, 0.5, 1.05];
const TAIL_FLEX = 0.035;

/** The tail sways sideways, growing towards its end (the head holds its line). */
const bendPoint = (point: Vec3, length: number, flex: number): Vec3 => {
  const behind = Math.max(0, -point[0] / length + 0.1);
  return [point[0], point[1], point[2] + flex * length * behind * behind * 4];
};

const isMarked = (look: FishLook, x: number, z: number, up: number) => {
  if (up < 0.35) return false;
  if (look.markings === "spots") return speckle(x * 90, up * 7, z * 90) > 0.55;
  return Math.sin(x * 140 + Math.sin(up * 6) * 1.8) > 0.35;
};

const paintBody = (look: FishLook) => (along: number, up: number, side: number) => {
  if (up < -0.35) return look.belly;
  if (Math.abs(up) < 0.15) return lerp3(look.side, look.band, 0.75);
  const base = up > 0.4 ? look.back : lerp3(look.side, look.back, Math.max(0, up) * 1.6);
  return isMarked(look, along, side, up) ? lerp3(base, [0.08, 0.09, 0.08], 0.75) : base;
};

const addBody = (builder: CritterBuilder, look: FishLook, place: (point: Vec3) => Vec3) => {
  const { length } = look;
  const stations: LoftStation[] = BODY.map(([x, height, width]) => ({
    at: place([x * length, 0, 0]),
    height: height * length,
    width: width * length
  }));
  builder.loft(stations, {
    endTip: 0.06 * length,
    paint: paintBody(look),
    sides: 8,
    startTip: 0.01 * length
  });
};

const addTail = (builder: CritterBuilder, look: FishLook, place: (point: Vec3) => Vec3) => {
  const { length } = look;
  const root = -0.42 * length;
  const tip = -0.56 * length;
  const rows: Vec3[][] = [
    [place([root, 0.035 * length, 0]), place([root, 0, 0]), place([root, -0.035 * length, 0])],
    [
      place([tip, 0.11 * length, 0]),
      place([tip + 0.06 * length, 0, 0]),
      place([tip, -0.11 * length, 0])
    ]
  ];
  builder.sheet(rows, () => lerp3(look.back, look.side, 0.3), [0, 0, 1]);
};

const addDorsalFin = (builder: CritterBuilder, look: FishLook, place: (point: Vec3) => Vec3) => {
  const { length } = look;
  const rows: Vec3[][] = [
    [place([0.08 * length, 0.12 * length, 0]), place([-0.08 * length, 0.11 * length, 0])],
    [place([0, 0.2 * length, 0]), place([-0.1 * length, 0.15 * length, 0])]
  ];
  builder.sheet(rows, () => look.back, [0, 0, 1]);
};

const createFishMesh = (look: FishLook, pitch: number, flex: number): PropMesh => {
  const builder = new CritterBuilder();
  const place = (point: Vec3) => pitchAbout(bendPoint(point, look.length, flex), [0, 0, 0], pitch);
  addBody(builder, look, place);
  addTail(builder, look, place);
  addDorsalFin(builder, look, place);
  return builder.finish();
};

const CLIPS = createClips({
  [CLIP.idle]: pose(2),
  [CLIP.air]: pose(0, 1, 2, 3, 4)
});

export const createFishModel = (look: FishLook): CritterModel => ({
  clips: CLIPS,
  frames: FISH_PITCHES.map((pitch, index) =>
    createFishMesh(look, pitch, index % 2 === 0 ? TAIL_FLEX : -TAIL_FLEX)
  )
});
