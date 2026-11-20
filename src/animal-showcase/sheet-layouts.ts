import type { AnimalMotion } from "../render-common/wildlife/model/animal-pose";
import {
  DAPPLED_VARIANT,
  getAnimalVariants,
  getRabbitVariant
} from "../render-common/wildlife/model/animal-variants";
import {
  createRabbitAppearance,
  RABBIT_COAT,
  type RabbitAppearance
} from "../render-common/wildlife/model/rabbit-coat";
import { REST_KIND } from "../render-common/wildlife/model/rest-pose";
import { SPECIES } from "../render-common/wildlife/wildlife-species";
import {
  LIFE_STAGE,
  type LifeStage,
  STAGE_SHAPES} from "../render-common/wildlife/wildlife-stages";

/** Where the orthographic camera looks from (the animal faces +x, its left side is +z). */
export const VIEWS = {
  front: [1, 0, 0],
  rear: [-1, 0, 0],
  side: [0, 0, 1],
  threeQuarter: [1, 0.55, 1]
} as const satisfies Record<string, readonly [number, number, number]>;

/** One animal in one view and pose. */
export interface SheetCell {
  antlers: number;
  /** Rabbit individual (coat, ears); the variant then holds its body type. */
  appearance: RabbitAppearance | null;
  /** Motion overrides (gait phase and weights, graze, alert) for the gait sheets. */
  motion?: Partial<AnimalMotion>;
  rest: number;
  restHead: number;
  restKind: number;
  scale: number;
  species: number;
  variant: number;
  view: readonly [number, number, number];
}

/** A row of cells (null leaves a cell empty); every animal in a row shares one scale. */
export type SheetRow = (SheetCell | null)[];

const MODEL_VIEWS = [VIEWS.front, VIEWS.side, VIEWS.rear, VIEWS.threeQuarter];

/** One cell of a sheet: the species variant (life stage) in the side view unless set. */
export const createSheetCell = (
  species: number,
  variant: number,
  options: Partial<Omit<SheetCell, "species" | "variant">> = {}
): SheetCell => ({
  antlers: 0,
  appearance: null,
  rest: 0,
  restHead: 0,
  restKind: 0,
  scale: getAnimalVariants(species)[variant]!.shape.size,
  species,
  variant,
  view: VIEWS.side,
  ...options
});

/** Front, side, rear and 3/4 of one animal. */
const modelRow = (species: number, variant: number, antlers: number): SheetRow =>
  MODEL_VIEWS.map((view) => createSheetCell(species, variant, { antlers, view }));

/** Coats of the lineup: every archetype at least once, the common ones more often. */
const LINEUP_COATS = [
  RABBIT_COAT.agouti,
  RABBIT_COAT.chestnut,
  RABBIT_COAT.tan,
  RABBIT_COAT.white,
  RABBIT_COAT.whitePatched,
  RABBIT_COAT.charcoal,
  RABBIT_COAT.agouti,
  RABBIT_COAT.whitePatched,
  RABBIT_COAT.agouti,
  RABBIT_COAT.chestnut
];
/** Life stage and pose of each lineup rabbit (standing, sitting up, loafing, grooming). */
const LINEUP_POSES: { rest: number; restKind: number; stage: LifeStage }[] = [
  { rest: 0, restKind: 0, stage: LIFE_STAGE.adult },
  { rest: 1, restKind: REST_KIND.sit, stage: LIFE_STAGE.adult },
  { rest: 0, restKind: 0, stage: LIFE_STAGE.adult },
  { rest: 1, restKind: REST_KIND.loaf, stage: LIFE_STAGE.adult },
  { rest: 0, restKind: 0, stage: LIFE_STAGE.adult },
  { rest: 1, restKind: REST_KIND.groom, stage: LIFE_STAGE.adult },
  { rest: 0, restKind: 0, stage: LIFE_STAGE.juvenile },
  { rest: 1, restKind: REST_KIND.crouch, stage: LIFE_STAGE.adult },
  { rest: 0, restKind: 0, stage: LIFE_STAGE.adolescent },
  { rest: 1, restKind: REST_KIND.sit, stage: LIFE_STAGE.adult }
];

/** First appearance seed (from `start`) whose individual wears the archetype. */
const findAppearance = (archetype: number, start: number) => {
  for (let seed = start; ; seed += 1) {
    const look = createRabbitAppearance(seed);
    if (look.archetype === archetype) return { look, seed };
  }
};

/**
 * Ten wild rabbits together (the variety quality test): distinct coats, patches, body types,
 * ears and poses, yet one species. Two rows of five, three quarter view.
 */
const createRabbitLineup = (): SheetRow[] => {
  let seed = 1;
  const cells = LINEUP_COATS.map((archetype, index) => {
    const found = findAppearance(archetype, seed);
    seed = found.seed + 1;
    const pose = LINEUP_POSES[index]!;
    const variant = getRabbitVariant(found.look.bodyType, pose.stage);
    return createSheetCell(SPECIES.rabbit, variant, {
      appearance: found.look,
      rest: pose.rest,
      restKind: pose.restKind,
      scale: STAGE_SHAPES[SPECIES.rabbit]![pose.stage]!.size,
      view: VIEWS.threeQuarter
    });
  });
  return [cells.slice(0, 5), cells.slice(5)];
};

/** Phases of one locomotion cycle, side view: walk, trot or gallop (`run`) weights. */
const gaitRow = (species: number, weights: Partial<AnimalMotion>, phases: readonly number[]) =>
  phases.map((gaitPhase) =>
    createSheetCell(species, LIFE_STAGE.adult, { motion: { ...weights, gaitPhase, move: 1 } })
  );

const SIX_PHASES = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6];

/** Standing behaviours: relaxed, grazing, alert (side), relaxed and grazing (3/4). */
const behaviourRow = (species: number) => [
  createSheetCell(species, LIFE_STAGE.adult),
  createSheetCell(species, LIFE_STAGE.adult, { motion: { graze: 1 } }),
  createSheetCell(species, LIFE_STAGE.adult, { motion: { alert: 1 } }),
  createSheetCell(species, LIFE_STAGE.adult, { view: VIEWS.threeQuarter }),
  createSheetCell(species, LIFE_STAGE.adult, { motion: { graze: 1 }, view: VIEWS.threeQuarter }),
  createSheetCell(species, LIFE_STAGE.adult, { motion: { alert: 1 }, view: VIEWS.threeQuarter })
];

/** Locomotion and behaviour review: walk, gallop and standing poses of deer and rabbit. */
const createGaitSheet = (): SheetRow[] => [
  gaitRow(SPECIES.deer, {}, SIX_PHASES),
  gaitRow(SPECIES.deer, { run: 1 }, SIX_PHASES),
  behaviourRow(SPECIES.deer),
  behaviourRow(SPECIES.rabbit),
  gaitRow(SPECIES.rabbit, { trot: 1 }, SIX_PHASES)
];

/**
 * The sheets of the lab: the elk model sheet, the deer model sheet in both coats (a plain brown
 * buck and a dappled doe), and the life stages per species with bedded poses.
 */
export const SHEETS: Record<string, SheetRow[]> = {
  deer: [modelRow(SPECIES.deer, LIFE_STAGE.adult, 1), modelRow(SPECIES.deer, DAPPLED_VARIANT, 0)],
  elk: [modelRow(SPECIES.elk, LIFE_STAGE.mature, 1)],
  gaits: createGaitSheet(),
  rabbit: [modelRow(SPECIES.rabbit, LIFE_STAGE.adult, 0)],
  rabbits: createRabbitLineup(),
  resting: [
    [
      createSheetCell(SPECIES.deer, LIFE_STAGE.adult, { rest: 1 }),
      createSheetCell(SPECIES.deer, LIFE_STAGE.adult, {
        rest: 1,
        restHead: 1,
        view: VIEWS.threeQuarter
      }),
      createSheetCell(SPECIES.deer, LIFE_STAGE.adult, { rest: 0.5 }),
      createSheetCell(SPECIES.elk, LIFE_STAGE.adult, { rest: 1, view: VIEWS.threeQuarter }),
      createSheetCell(SPECIES.elk, LIFE_STAGE.adult, { rest: 1, restHead: 1, view: VIEWS.rear })
    ],
    [
      ...[REST_KIND.sit, REST_KIND.loaf, REST_KIND.crouch, REST_KIND.groom].map((restKind) =>
        createSheetCell(SPECIES.rabbit, LIFE_STAGE.adult, { rest: 1, restKind })
      ),
      null
    ]
  ],
  stages: [
    [
      createSheetCell(SPECIES.deer, LIFE_STAGE.newborn),
      createSheetCell(SPECIES.deer, LIFE_STAGE.juvenile),
      createSheetCell(SPECIES.deer, LIFE_STAGE.adolescent, { antlers: 1 }),
      createSheetCell(SPECIES.deer, LIFE_STAGE.adult, { antlers: 1 }),
      createSheetCell(SPECIES.deer, LIFE_STAGE.newborn, { rest: 1, view: VIEWS.threeQuarter }),
      createSheetCell(SPECIES.deer, LIFE_STAGE.adult, { rest: 1, view: VIEWS.threeQuarter })
    ],
    [
      createSheetCell(SPECIES.elk, LIFE_STAGE.newborn),
      createSheetCell(SPECIES.elk, LIFE_STAGE.juvenile),
      createSheetCell(SPECIES.elk, LIFE_STAGE.adolescent, { antlers: 1 }),
      createSheetCell(SPECIES.elk, LIFE_STAGE.adult, { antlers: 1 }),
      createSheetCell(SPECIES.elk, LIFE_STAGE.mature, { antlers: 1 }),
      createSheetCell(SPECIES.elk, LIFE_STAGE.mature, {
        antlers: 1,
        rest: 1,
        view: VIEWS.threeQuarter
      })
    ],
    [
      createSheetCell(SPECIES.rabbit, LIFE_STAGE.newborn),
      createSheetCell(SPECIES.rabbit, LIFE_STAGE.juvenile),
      createSheetCell(SPECIES.rabbit, LIFE_STAGE.adult),
      createSheetCell(SPECIES.rabbit, LIFE_STAGE.adult, { rest: 1, view: VIEWS.threeQuarter }),
      null,
      null
    ]
  ]
};
