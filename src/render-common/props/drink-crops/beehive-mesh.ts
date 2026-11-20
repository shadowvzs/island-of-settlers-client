import { createRandom, type Random } from "../../../shared/world/rng";
import { MeshBuilder, type Vec3, type VertexStyle } from "../mesh-builder";
import { addLathe, addStaticBox, solid } from "./crop-mesh-parts";

/**
 * Viking beekeeping site (prop space, one unit = one cell): a coiled straw skep with its straw
 * hackle on a plank bench. Ekes (straw rings) go under the skep as the colony
 * fills it; at harvest the skep is lifted aside and the cut combs (three-hive-combs.ts) stand on
 * the bench. Static: the
 * renderer only moves whole pieces (skep height, lifted skep) and the bees.
 */
export const HIVE_BENCH_TOP = 0.3;
export const HIVE_EKE_HEIGHT = 0.05;
const SKEP_RADIUS = 0.135;
const SKEP_HEIGHT = 0.25;
const STRAW: Vec3 = [0.78, 0.62, 0.33];
const BENCH: Vec3 = [0.47, 0.35, 0.22];
const HONEY: Vec3 = [0.86, 0.55, 0.12];

/** Straw coils: alternating light ridges and darker grooves every `pitch` of height. */
const coiledStraw = (pitch: number, random: Random): VertexStyle => ({
  color: ([, y]) => {
    const groove = 0.82 + 0.18 * Math.abs(Math.sin((y / pitch) * Math.PI));
    const factor = groove * (0.95 + random() * 0.1);
    return [STRAW[0] * factor, STRAW[1] * factor, STRAW[2] * factor];
  },
  flutter: 0
});

/** A plank bench standing on the ground; the skep stands on its top. */
export const createHiveStandMesh = (detailed: boolean) => {
  const builder = new MeshBuilder(), random = createRandom(31);
  addStaticBox(builder, [0, HIVE_BENCH_TOP - 0.02, 0], [0.38, 0.04, 0.32], solid(BENCH, random));
  for (const x of [-0.15, 0.15]) for (const z of [-0.12, 0.12])
    addStaticBox(builder, [x, (HIVE_BENCH_TOP - 0.05) / 2, z], [0.04, HIVE_BENCH_TOP - 0.01, 0.04],
      solid([0.4, 0.3, 0.19], random));
  if (detailed) addStaticBox(builder, [0, 0.14, 0], [0.32, 0.03, 0.03], solid([0.4, 0.3, 0.19], random));
  return builder.finish({ flex: 0 });
};

/** One straw eke ring that raises the skep (ekes are stacked as the colony grows). */
export const createHiveEkeMesh = (detailed: boolean) => {
  const builder = new MeshBuilder(), random = createRandom(37);
  addLathe(builder, { centre: [0, 0, 0], profile: [[SKEP_RADIUS, 0], [SKEP_RADIUS * 1.04, HIVE_EKE_HEIGHT / 2],
    [SKEP_RADIUS, HIVE_EKE_HEIGHT]], segments: detailed ? 16 : 8 }, coiledStraw(HIVE_EKE_HEIGHT / 2, random));
  return builder.finish({ flex: 0 });
};

const skepProfile = (rings: number) => Array.from({ length: rings + 1 }, (_, ring): readonly [number, number] => {
  const t = ring / rings;
  const dome = Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.2)));
  const ridge = 1 + 0.03 * Math.abs(Math.sin(t * rings * Math.PI / 2));
  return [SKEP_RADIUS * dome * ridge, t * SKEP_HEIGHT];
});

/** The coiled skep with its entrance and (High) the conical straw hackle against the rain. */
export const createSkepMesh = (detailed: boolean) => {
  const builder = new MeshBuilder(), random = createRandom(41);
  addLathe(builder, { centre: [0, 0, 0], profile: skepProfile(detailed ? 16 : 6), segments: detailed ? 16 : 8 },
    coiledStraw(SKEP_HEIGHT / 8, random));
  addStaticBox(builder, [0, 0.014, SKEP_RADIUS - 0.004], [0.05, 0.026, 0.02], solid([0.12, 0.09, 0.06]));
  if (detailed) {
    addLathe(builder, { centre: [0, SKEP_HEIGHT * 0.62, 0], profile: [[SKEP_RADIUS * 0.9, 0],
      [SKEP_RADIUS * 0.55, 0.08], [0.012, 0.16], [0, 0.17]], segments: 12 }, solid([0.72, 0.6, 0.34], random));
    for (const y of [0.33, 0.66])
      addLathe(builder, { centre: [0, SKEP_HEIGHT * y, 0], profile: [[SKEP_RADIUS * (y > 0.5 ? 0.86 : 1.02), 0],
        [SKEP_RADIUS * (y > 0.5 ? 0.82 : 1.0), 0.012]], segments: 16 }, solid([0.45, 0.33, 0.2]));
  }
  return builder.finish({ flex: 0 });
};

/** A honey run at the full hive's entrance. */
export const createHoneyDripMesh = () => {
  const builder = new MeshBuilder();
  addLathe(builder, { centre: [0, -0.035, SKEP_RADIUS + 0.004], profile: [[0, 0], [0.008, 0.008], [0.011, 0.022],
    [0.016, 0.034], [0.012, 0.036]], segments: 6 }, solid(HONEY));
  return builder.finish({ flex: 0 });
};
