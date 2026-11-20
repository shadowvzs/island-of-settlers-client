import { smoothstep } from "../../../shared/world/noise";
import { SPECIES } from "../wildlife-species";
import type { StageShape } from "../wildlife-stages";
import { type AnimalModel, PART } from "./animal-rig";
import { morphModel } from "./model-morph";

const ADULT_SHAPE: StageShape = {
  antlers: 3,
  body: [1, 1, 1],
  ears: 1,
  head: [1, 1, 1],
  legs: 1,
  neckLength: 1,
  neckThickness: 1,
  size: 1,
  spots: 0,
  warmth: 0
};

/**
 * Adult proportions over the source models (reference photographs in profile). Legs keep their
 * length everywhere, so the gaits, foot placement and leg tables stay valid.
 * - Red deer: the source doe stands tall on a short trunk with a long thin neck (a llama at game
 *   distance). The trunk is lengthened to about the shoulder height, the chest deepened, the
 *   neck shortened and thickened at its base, the head made a little fuller. Grazing, it
 *   lowers its forequarters as real deer do (secondary-motion addGrazeStance), so the
 *   shorter neck still reaches the grass.
 * - Elk: not a scaled red deer. Heavier, deeper chest and trunk, a thick maned neck carried
 *   lower and shorter, a bigger head.
 * - Wild rabbit: the source is hare-like. A rounder, deeper body, a fuller head and shorter
 *   ears (wild European rabbit rather than a hare).
 */
export const SPECIES_ANATOMY: Record<number, StageShape> = {
  [SPECIES.rabbit]: { ...ADULT_SHAPE, body: [0.97, 1.06, 1.1], ears: 0.84, head: [1.03, 1.05, 1.08] },
  [SPECIES.deer]: {
    ...ADULT_SHAPE,
    body: [1.1, 1.04, 1.06],
    ears: 0.95,
    head: [1, 1.03, 1.05],
    neckLength: 0.85,
    neckThickness: 1.15
  },
  [SPECIES.elk]: {
    ...ADULT_SHAPE,
    body: [1.06, 1.08, 1.12],
    head: [1.04, 1.06, 1.08],
    neckLength: 0.94,
    neckThickness: 1.22
  }
};

/** Hoof height per species (model units): below it the lower leg widens into the hoof. */
const HOOF_HEIGHT: Record<number, number> = { [SPECIES.deer]: 0.04, [SPECIES.elk]: 0.055 };
/** Hoof growth at the sole (length along the body, width across). */
const HOOF_LENGTH = 1.3;
const HOOF_WIDTH = 1.22;

const LOWER_LEGS = [
  PART.frontLeftLower,
  PART.frontRightLower,
  PART.hindLeftLower,
  PART.hindRightLower
] as const;

/** Centre of each lower leg's sole (x, z) in the rest pose. */
const getSoleCentres = (model: AnimalModel, hoofHeight: number) => {
  const centres = new Map<number, { count: number; x: number; z: number }>();
  const { positions } = model.mesh;
  for (let vertex = 0; vertex < model.parts.length; vertex += 1) {
    const part = model.parts[vertex]!;
    if (!(LOWER_LEGS as readonly number[]).includes(part)) continue;
    if (positions[vertex * 3 + 1]! > hoofHeight) continue;
    const centre = centres.get(part) ?? { count: 0, x: 0, z: 0 };
    centre.count += 1;
    centre.x += positions[vertex * 3]!;
    centre.z += positions[vertex * 3 + 2]!;
    centres.set(part, centre);
  }
  return centres;
};

/**
 * The source hooves are small points under long thin pasterns (a high-heel look). The lowest
 * part of each lower leg widens towards the sole into a sturdier cloven hoof; the sole stays on
 * the ground and the leg above the hoof height is untouched.
 */
const widenHooves = (model: AnimalModel, hoofHeight: number): AnimalModel => {
  const centres = getSoleCentres(model, hoofHeight);
  const positions = Float32Array.from(model.mesh.positions);
  for (let vertex = 0; vertex < model.parts.length; vertex += 1) {
    const centre = centres.get(model.parts[vertex]!);
    const y = positions[vertex * 3 + 1]!;
    if (!centre || y > hoofHeight) continue;
    const growth = 1 - smoothstep(0, hoofHeight, y);
    const x = centre.x / centre.count;
    const z = centre.z / centre.count;
    positions[vertex * 3] = x + (positions[vertex * 3]! - x) * (1 + (HOOF_LENGTH - 1) * growth);
    positions[vertex * 3 + 2] = z + (positions[vertex * 3 + 2]! - z) * (1 + (HOOF_WIDTH - 1) * growth);
  }
  return { ...model, mesh: { ...model.mesh, positions } };
};

/** The adult in its species' proportions (every level of detail, before the life stages). */
export const applySpeciesAnatomy = (species: number, model: AnimalModel) => {
  const shaped = morphModel(model, SPECIES_ANATOMY[species]!);
  const hoofHeight = HOOF_HEIGHT[species];
  return hoofHeight === undefined ? shaped : widenHooves(shaped, hoofHeight);
};
