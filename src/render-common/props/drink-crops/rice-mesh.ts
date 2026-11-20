import { createRandom, type Random } from "../../../shared/world/rng";
import { MeshBuilder, type Vec3 } from "../mesh-builder";
import { type Palette,pickTone, shaded } from "../plants/plant-colors";
import { addBlade, addSpindle, addStemTube, type Attach,growStem } from "../plants/plant-parts";
import { addStaticBox, solid } from "./crop-mesh-parts";

/**
 * Rice hills of one flooded paddy cell (prop space, one unit = one cell). Transplanted
 * seedlings in rows, dense green tillers, upright green panicles, and golden heads bending over
 * when ripe; the blades bend in the shared vegetation wind. Water and bunds are drawn apart.
 */
export type RiceStage = "seedling" | "tillering" | "heading" | "ripe" | "stubble";

const RICE_GREENS: Palette = {
  base: [0.56, 0.78, 0.26],
  dark: [0.4, 0.6, 0.18],
  dry: [0.8, 0.72, 0.38],
  light: [0.72, 0.9, 0.34]
};
const RICE_GOLDS: Palette = {
  base: [0.92, 0.74, 0.32],
  dark: [0.74, 0.56, 0.22],
  dry: [0.84, 0.7, 0.4],
  light: [1, 0.86, 0.42]
};
const STRAW: Vec3 = [0.7, 0.6, 0.36];
const HILL_SPAN = 0.62;

interface StageShape {
  blades: number;
  length: readonly [number, number];
  panicles: number;
  palette: Palette;
}

const STAGES: Record<Exclude<RiceStage, "stubble">, StageShape> = {
  heading: { blades: 8, length: [0.27, 0.34], palette: RICE_GREENS, panicles: 2 },
  ripe: { blades: 7, length: [0.26, 0.32], palette: RICE_GOLDS, panicles: 2 },
  seedling: { blades: 4, length: [0.08, 0.12], palette: RICE_GREENS, panicles: 0 },
  tillering: { blades: 9, length: [0.24, 0.32], palette: RICE_GREENS, panicles: 0 }
};

/** Hill centres on a transplanting grid with a little hand-planting jitter. */
const hillCentres = (detailed: boolean, random: Random): Vec3[] => {
  const count = detailed ? 4 : 3;
  const centres: Vec3[] = [];
  for (let row = 0; row < count; row += 1) for (let column = 0; column < count; column += 1) {
    const x = (column / (count - 1) - 0.5) * HILL_SPAN + (random() - 0.5) * 0.03;
    const z = (row / (count - 1) - 0.5) * HILL_SPAN + (random() - 0.5) * 0.03;
    centres.push([x, 0, z]);
  }
  return centres;
};

const addHillBlades = (builder: MeshBuilder, centre: Vec3, shape: StageShape, detailed: boolean,
  random: Random) => {
  const blades = detailed ? shape.blades : Math.ceil(shape.blades * 0.6);
  for (let index = 0; index < blades; index += 1) {
    const root: Attach = { path: 0, position: [centre[0] + (random() - 0.5) * 0.02, -0.01,
      centre[2] + (random() - 0.5) * 0.02] };
    addBlade(builder, root, {
      arch: 0.25 + random() * 0.55,
      azimuth: (index / blades) * Math.PI * 2 + random() * 0.5,
      lean: 0.08 + random() * 0.3,
      length: shape.length[0] + random() * (shape.length[1] - shape.length[0]),
      segments: detailed ? 3 : 2,
      tipFlutter: 0.7,
      width: detailed ? 0.016 : 0.022
    }, shaded(pickTone(shape.palette, random, 0.08), random));
  }
};

/** A panicle: thin culm above the leaves, then grains along its (bowed when ripe) tip. */
const addPanicle = (builder: MeshBuilder, centre: Vec3, ripe: boolean, detailed: boolean, random: Random) => {
  const azimuth = random() * Math.PI * 2;
  const out: Vec3 = [Math.cos(azimuth), 0, Math.sin(azimuth)];
  const culm = growStem({ bend: ripe ? -0.32 : 0.02, direction: [out[0] * 0.15, 1, out[2] * 0.15],
    length: ripe ? 0.4 : 0.38, start: [centre[0], -0.01, centre[2]], steps: 4, wobble: 0.04 }, random);
  const color = ripe ? pickTone(RICE_GOLDS, random) : [0.58, 0.68, 0.3] as Vec3;
  if (!detailed) {
    addBlade(builder, { path: culm.paths[2]!, position: culm.points[2]! }, { arch: ripe ? 2.2 : 0.3,
      azimuth, lean: ripe ? 0.8 : 0.1, length: 0.13, segments: 2, tipFlutter: 0.2, width: 0.026 },
    solid(color, random));
    return;
  }
  addStemTube(builder, culm, [0.003, 0.002], 3, shaded(ripe ? STRAW : [0.46, 0.58, 0.24], random));
  const style = solid(color, random, 0.1);
  for (let grain = 0; grain < 4; grain += 1) {
    const index = 2 + Math.min(culm.points.length - 3, Math.floor(grain * 0.7));
    const at: Attach = { path: culm.paths[index]!, position: culm.points[index]! };
    const side = grain % 2 ? 1 : -1;
    const axis: Vec3 = [side * out[2] * 0.6 + out[0] * 0.3, ripe ? -0.8 : 0.9, -side * out[0] * 0.6 + out[2] * 0.3];
    addSpindle(builder, at, { axis, length: 0.03, profile: t => Math.sin(Math.PI * t) * 0.007, rings: 2,
      sides: 3 }, style);
  }
};

/** Cut stubble standing in the drained paddy after the harvest. */
const addStubble = (builder: MeshBuilder, centre: Vec3, random: Random) => {
  for (let stub = 0; stub < 5; stub += 1)
    addStaticBox(builder, [centre[0] + (random() - 0.5) * 0.035, 0.025, centre[2] + (random() - 0.5) * 0.035],
      [0.007, 0.06, 0.007], solid(STRAW, random, 0.15), random() * 3);
};

/** Heading panicles and leaves turn from green to gold before the ripe (bent) stage. */
export const RICE_TINTS = {
  ripe: [1.45, 1.02, 0.55] as Vec3,
  unripe: [1, 1, 1] as Vec3
};

export const createRiceMesh =(stage: RiceStage, detailed: boolean, seed = 9) => {
  const builder = new MeshBuilder(), random = createRandom(seed);
  for (const centre of hillCentres(detailed, random)) {
    if (stage === "stubble") { addStubble(builder, centre, random); continue; }
    const shape = STAGES[stage];
    addHillBlades(builder, centre, shape, detailed, random);
    for (let panicle = 0; panicle < shape.panicles; panicle += 1)
      addPanicle(builder, centre, stage === "ripe", detailed, random);
  }
  return builder.finish({ contactRadius: 0, flex: 0.9 });
};
