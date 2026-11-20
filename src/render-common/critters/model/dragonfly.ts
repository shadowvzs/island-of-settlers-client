import { lerp3 } from "../../../shared/world/noise";
import type { PropMesh, Vec3 } from "../../props/mesh-builder";
import { CritterBuilder, flat } from "./critter-builder";
import { CLIP, createClips, type CritterModel,cycle, pose } from "./critter-model";

/**
 * Emperor dragonfly: an original procedural model in world units (origin at the thorax): a long
 * blue abdomen ringed black, green thorax, big blue-green eyes and four glassy wings, here as
 * raised, level and lowered frames for the wing beat.
 */
const DRAGONFLY = {
  blue: [0.16, 0.42, 0.86] as Vec3,
  eye: [0.2, 0.55, 0.5] as Vec3,
  ring: [0.05, 0.06, 0.08] as Vec3,
  thorax: [0.32, 0.52, 0.24] as Vec3,
  vein: [0.55, 0.6, 0.62] as Vec3,
  wing: [0.84, 0.9, 0.93] as Vec3
};

const ABDOMEN_RINGS = 8;

const addBody = (builder: CritterBuilder) => {
  const stations = Array.from({ length: ABDOMEN_RINGS + 1 }, (_, index) => {
    const t = index / ABDOMEN_RINGS;
    const radius = 0.0032 * (1 - t * 0.45);
    return { at: [-0.006 - t * 0.058, 0, 0] as Vec3, height: radius, width: radius };
  });
  builder.loft(stations, {
    endTip: 0.002,
    paint: (along) => {
      const ring = (along * ABDOMEN_RINGS) % 1 > 0.78;
      return ring ? DRAGONFLY.ring : DRAGONFLY.blue;
    },
    sides: 6
  });
  builder.ellipsoid(
    [0.003, 0.0005, 0],
    [1, 0, 0],
    [0.009, 0.0055, 0.005],
    flat(DRAGONFLY.thorax),
    4,
    7
  );
  for (const sign of [1, -1]) {
    const eye: Vec3 = [0.0125, 0.001, sign * 0.0035];
    builder.ellipsoid(eye, [1, 0, 0], [0.0045, 0.0045, 0.0042], flat(DRAGONFLY.eye), 3, 6);
  }
};

/** One wing as a sheet from root to tip (leading edge forward), raised by `angle`. */
const addWing = (
  builder: CritterBuilder,
  rootX: number,
  chord: number,
  sign: number,
  angle: number
) => {
  const span = 0.046;
  const rows: Vec3[][] = [0, 0.35, 0.75, 1].map((t) => {
    const reach = span * t;
    const width = chord * (t < 0.9 ? 1 - t * 0.25 : 0.5);
    const y = Math.sin(angle) * reach + 0.002;
    const z = sign * (0.003 + Math.cos(angle) * reach);
    return [
      [rootX + 0.002, y, z],
      [rootX - width, y, z]
    ];
  });
  builder.sheet(rows, (row) => lerp3(DRAGONFLY.wing, DRAGONFLY.vein, row === 0 ? 0.5 : 0), [0, 1, 0]);
};

const createDragonflyMesh = (angle: number): PropMesh => {
  const builder = new CritterBuilder();
  addBody(builder);
  for (const sign of [1, -1]) {
    addWing(builder, 0.006, 0.008, sign, angle);
    addWing(builder, -0.003, 0.0095, sign, -angle * 0.8);
  }
  return builder.finish();
};

/** Frames: wings raised, level, lowered. */
const CLIPS = createClips({
  [CLIP.idle]: pose(1),
  [CLIP.fly]: cycle(0, 1, 2, 1)
});

export const createDragonflyModel = (): CritterModel => ({
  clips: CLIPS,
  frames: [0.45, 0, -0.35].map(createDragonflyMesh)
});
