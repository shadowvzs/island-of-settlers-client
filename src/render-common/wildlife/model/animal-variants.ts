import { SPECIES } from "../wildlife-species";
import {
  ANTLER_STAGE,
  LIFE_STAGE,
  type LifeStage,
  STAGE_SHAPES,
  type StageShape
} from "../wildlife-stages";
import type { AnimalAsset, ModelLod } from "./animal-asset";
import { type AnimalModel,PART } from "./animal-rig";
import { addAntlerTint, addDeerZones, addElkZones, getElkRumpPatch } from "./cervid-coat";
import { morphModel } from "./model-morph";
import { addRabbitMasks } from "./rabbit-coat-shading";
import { applySpeciesAnatomy } from "./species-anatomy";
import { WINTER_GRADES } from "./winter-coat";

/** One drawn variant: a life stage and, for adult deer, the dappled coat. */
export interface AnimalVariant {
  shape: StageShape;
  stage: LifeStage;
}

/** Adult deer with faint dapples (owner: a spotted and a plain brown coat). */
const DAPPLED_ADULT_SPOTS = 0.32;
export const DAPPLED_VARIANT = 5;

/** Rack size per antler stage: none, buttons / spikes, small branching, the full rack. */
const ANTLER_STAGE_SCALE = [0, 0.4, 0.7, 1] as const;

const stageVariants = (species: number): AnimalVariant[] =>
  STAGE_SHAPES[species]!.map((shape, stage) => ({ shape, stage: stage as LifeStage }));

/** Rabbit body types (scale factors on the stage shape): lean / wild, compact. */
const RABBIT_BODY_TYPES: Pick<StageShape, "body" | "ears" | "head" | "legs">[] = [
  { body: [1.05, 0.96, 0.94], ears: 1.08, head: [0.97, 0.97, 0.95], legs: 1.04 },
  { body: [0.94, 1.04, 1.07], ears: 0.9, head: [1.03, 1.03, 1.07], legs: 0.97 }
];

const times = (a: readonly number[], b: readonly number[]) =>
  [a[0]! * b[0]!, a[1]! * b[1]!, a[2]! * b[2]!] as const;

/** A rabbit body type applied to every life stage (variant = body type x stages + stage). */
const withBodyType = (variants: AnimalVariant[], bodyType: number) => {
  const type = RABBIT_BODY_TYPES[bodyType]!;
  return variants.map(({ shape, stage }) => ({
    shape: {
      ...shape,
      body: times(shape.body, type.body),
      ears: shape.ears * type.ears,
      head: times(shape.head, type.head),
      legs: shape.legs * type.legs
    },
    stage
  }));
};

/** Variant index of a rabbit body type and life stage. */
export const getRabbitVariant = (bodyType: number, stage: number) =>
  bodyType * STAGE_SHAPES[SPECIES.rabbit]!.length + stage;

/**
 * Every variant of a species, index = life stage (deer add the dappled adult at
 * DAPPLED_VARIANT, rabbits repeat the stages per body type: getRabbitVariant).
 */
export const getAnimalVariants = (species: number): AnimalVariant[] => {
  const variants = stageVariants(species);
  if (species === SPECIES.rabbit) {
    return RABBIT_BODY_TYPES.flatMap((_, bodyType) => withBodyType(variants, bodyType));
  }
  if (species !== SPECIES.deer) return variants;
  const adult = variants[LIFE_STAGE.adult]!;
  return [
    ...variants,
    { shape: { ...adult.shape, spots: DAPPLED_ADULT_SPOTS }, stage: LIFE_STAGE.adult }
  ];
};

/** Antlers grow in stages, never from none to the full rack (rack scale about its base). */
export const getStageAntlerScale = (stage: number) =>
  ANTLER_STAGE_SCALE[stage] ?? ANTLER_STAGE_SCALE[ANTLER_STAGE.full];

/** The rack at a stage's size, or (none) without its triangles at all. */
const withAntlerStage = (model: AnimalModel, stage: number): AnimalModel => {
  const scale = getStageAntlerScale(stage);
  if (scale === 1) return model;
  const { indices, positions } = model.mesh;
  const isAntler = (vertex: number) => model.parts[vertex] === PART.antler;
  if (scale === 0) {
    const kept = indices.filter((_, index) => !isAntler(indices[index - (index % 3)]!));
    return { ...model, mesh: { ...model.mesh, indices: kept } };
  }
  const scaled = Float32Array.from(positions);
  const pivot = model.antlerPivot;
  for (let vertex = 0; vertex < model.parts.length; vertex += 1) {
    if (!isAntler(vertex)) continue;
    for (let axis = 0; axis < 3; axis += 1) {
      const at = vertex * 3 + axis;
      scaled[at] = pivot[axis]! + (positions[at]! - pivot[axis]!) * scale;
    }
  }
  return { ...model, mesh: { ...model.mesh, positions: scaled } };
};

/**
 * The species' own preparation of the adult model: proportions and the summer or winter coat
 * (masks, colour zones, the winter grade).
 */
const prepareCoat = (species: number, model: AnimalModel, winter: boolean) => {
  if (species === SPECIES.rabbit) return addRabbitMasks(model);
  const tinted = addAntlerTint(model);
  return species === SPECIES.elk ? addElkZones(tinted, winter) : addDeerZones(tinted, winter);
};

const prepareAdult = (species: number, source: AnimalModel, winter: boolean): AnimalModel => {
  const coated = prepareCoat(species, applySpeciesAnatomy(species, source), winter);
  return winter ? { ...coated, winterGrade: WINTER_GRADES[species] } : coated;
};

/**
 * All variants of a species at one level of detail, from the loaded adult model: each life
 * stage's proportions about the skeleton (never one uniform scale), its antler stage and
 * juvenile coat (spots, warmth; rabbits: the softer young coat); `winter` selects the cosmetic
 * winter coat.
 */
export const createAnimalVariants = (
  species: number,
  asset: AnimalAsset,
  lod: ModelLod,
  winter = false
): AnimalModel[] => {
  const base = prepareAdult(species, asset.lods[lod]!, winter);
  return getAnimalVariants(species).map(({ shape }) => {
    const staged = morphModel(withAntlerStage(base, shape.antlers), shape);
    if (species === SPECIES.rabbit) return { ...staged, coatMasks: { juvenile: shape.warmth } };
    const coat = { spots: shape.spots, warmth: shape.warmth };
    if (species !== SPECIES.elk) return { ...staged, ...coat };
    return { ...staged, ...coat, rumpPatch: getElkRumpPatch(staged) };
  });
};
