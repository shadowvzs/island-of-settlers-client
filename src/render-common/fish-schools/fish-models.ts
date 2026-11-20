import { CritterBuilder, type LoftStation, type Paint } from "../critters/model/critter-builder";
import type { PropMesh, Vec3 } from "../props/mesh-builder";
import type { FishSpecies, FishTail } from "./fish-species";
import { FISH_SPECIES } from "./fish-species";

/**
 * Original low-poly fish of the schools (forward +x, up +y, centred on the body, world units):
 * a lofted body, a tail of the species' outline (upright, plus a flatter spread that reads from
 * the iso camera above), dorsal, anal and spread pectoral fins. Colours, markings, scales
 * and the eyes are painted per pixel by the fish shader from the body coordinates (crisp at any
 * mesh resolution); the mesh only says which vertices are fins (`fin`). The tail wag is a vertex
 * shader bend, so one static mesh serves every pose.
 */
export interface FishModel {
  /** 1 for fin and tail vertices, 0 for the body. */
  fin: Float32Array;
  mesh: PropMesh;
}

/** Station x as a share of the length, tail root (first) to snout (last). */
const STATIONS = [-0.4, -0.3, -0.15, 0.02, 0.2, 0.34, 0.46];
const SIDES = 8;
const TAIL_ROOT = -0.42;
/** Plan-view tail spread relative to the upright tail's span. */
const PLAN_TAIL_SHARE = 0.7;
/** Length share where the pectoral fins leave the body (behind the gills). */
const PECTORAL_ROOT = 0.24;
const WHITE: Vec3 = [1, 1, 1];
const paintWhite: Paint = () => WHITE;

/** Tip row of the tail sheet (x share, y share of the span): top, middle, bottom. */
const TAIL_TIPS: Record<FishTail, readonly (readonly [number, number])[]> = {
  forked: [[-0.62, 1], [-0.5, 0], [-0.62, -1]],
  lunate: [[-0.62, 1.05], [-0.53, 0], [-0.62, -1.05]],
  round: [[-0.57, 0.8], [-0.62, 0], [-0.57, -0.8]]
};

/** Half body height share at a length share x (linear between the stations). */
export const getBodyHeightShare = (species: FishSpecies, x: number) => {
  if (x <= STATIONS[0]!) return species.body[0]!;
  for (let index = 1; index < STATIONS.length; index += 1) {
    const end = STATIONS[index]!;
    if (x > end) continue;
    const start = STATIONS[index - 1]!;
    const t = (x - start) / (end - start);
    return species.body[index - 1]! + (species.body[index]! - species.body[index - 1]!) * t;
  }
  return species.body[species.body.length - 1]!;
};

const getTailSpan = (species: FishSpecies) => 0.1 + 0.3 * Math.max(...species.body);

const addBody = (builder: CritterBuilder, species: FishSpecies) => {
  const { length } = species;
  const stations: LoftStation[] = STATIONS.map((x, index) => ({
    at: [x * length, 0, 0],
    height: species.body[index]! * length,
    width: species.body[index]! * species.thickness * length
  }));
  builder.loft(stations, { endTip: 0.05 * length, paint: paintWhite, sides: SIDES, startTip: 0.01 * length });
};

const addTail = (builder: CritterBuilder, species: FishSpecies) => {
  const { length } = species;
  const root = species.body[0]! * length;
  const span = getTailSpan(species) * length;
  const rows: Vec3[][] = [
    [[TAIL_ROOT * length, root, 0], [TAIL_ROOT * length, 0, 0], [TAIL_ROOT * length, -root, 0]],
    TAIL_TIPS[species.tail].map(([x, y]): Vec3 => [x * length, y * span, 0])
  ];
  builder.sheet(rows, () => WHITE, [0, 0, 1]);
};

/** A fin on the back (sign 1) or the belly (sign -1) between two length shares. */
const addFin = (
  builder: CritterBuilder,
  species: FishSpecies,
  span: readonly [number, number],
  rise: number,
  sign: number
) => {
  const { length } = species;
  const [front, back] = span;
  const base = (x: number): Vec3 => [x * length, sign * getBodyHeightShare(species, x) * length * 0.92, 0];
  const tip = (x: number, share: number): Vec3 => {
    const [bx, by] = base(x);
    return [bx - 0.06 * length, by + sign * rise * share * length, 0];
  };
  const rows: Vec3[][] = [[base(front), base(back)], [tip(front, 1), tip(back, 0.55)]];
  builder.sheet(rows, () => WHITE, [0, 0, 1]);
};

/**
 * The tail's flat spread seen from above: a lower copy of the tail outline laid in the plan
 * (the iso camera looks down on the fish, where an upright tail alone reads as a line).
 */
const addTailSpread = (builder: CritterBuilder, species: FishSpecies) => {
  const { length } = species;
  const root = species.body[0]! * species.thickness * length;
  const span = getTailSpan(species) * length * PLAN_TAIL_SHARE;
  const rows: Vec3[][] = [
    [[TAIL_ROOT * length, 0, root], [TAIL_ROOT * length, 0, 0], [TAIL_ROOT * length, 0, -root]],
    TAIL_TIPS[species.tail].map(([x, z]): Vec3 => [x * length, 0, z * span])
  ];
  builder.sheet(rows, () => WHITE, [0, 1, 0]);
};

/** Pectoral fins: spread sideways and back from behind the gills, seen from above. */
const addPectorals = (builder: CritterBuilder, species: FishSpecies) => {
  const { length } = species;
  const height = getBodyHeightShare(species, PECTORAL_ROOT) * length;
  const width = height * species.thickness * 0.9;
  const y = -height * 0.25;
  for (const side of [-1, 1]) {
    const rows: Vec3[][] = [
      [[PECTORAL_ROOT * length, y, side * width], [(PECTORAL_ROOT - 0.08) * length, y, side * width]],
      [[(PECTORAL_ROOT - 0.1) * length, y - 0.02 * length, side * (width + 0.13 * length)],
        [(PECTORAL_ROOT - 0.16) * length, y - 0.02 * length, side * (width + 0.1 * length)]]
    ];
    builder.sheet(rows, () => WHITE, [0, 1, 0]);
  }
};

/** Dorsal and anal fins: tall and long on the disc-shaped reef fish, small on the others. */
const addFins = (builder: CritterBuilder, species: FishSpecies) => {
  const disc = species.thickness < 0.5;
  const rise = disc ? 0.12 : 0.07;
  addFin(builder, species, disc ? [0.18, -0.34] : [0.12, -0.14], rise, 1);
  addFin(builder, species, disc ? [0.0, -0.34] : [-0.12, -0.28], rise * 0.7, -1);
};

export const createFishModel = (species: FishSpecies): FishModel => {
  const builder = new CritterBuilder();
  addBody(builder, species);
  const bodyVertices = builder.vertexCount;
  addTail(builder, species);
  addTailSpread(builder, species);
  addFins(builder, species);
  addPectorals(builder, species);
  const mesh = builder.finish();
  const fin = new Float32Array(builder.vertexCount);
  fin.fill(1, bodyVertices);
  return { fin, mesh };
};

let cachedModels: readonly FishModel[] | null = null;

/** One model per species (FISH_SPECIES order), built once. */
export const getFishModels = () => {
  cachedModels ??= FISH_SPECIES.map(createFishModel);
  return cachedModels;
};
