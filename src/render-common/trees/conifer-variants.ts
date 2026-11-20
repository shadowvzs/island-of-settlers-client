import { COMPETITION, CONIFER, encodeTreeForm } from "../../shared/world/tree-forms";
import type { GrowthStage } from "./tree-model";

/** One island mesh of a tree kind: its structural form byte and growth stage. */
export interface TreeVariant {
  form: number;
  stage: GrowthStage;
}

const ALL_COMPETITION = [COMPETITION.open, COMPETITION.interior, COMPETITION.edge];
const OPEN_ONLY = [COMPETITION.open];

/**
 * Competition forms each archetype is built in: forest trees (spruce, tall forest pine) react
 * to the stand; the mountain pine grows open.
 */
const COMPETITION_BY_ARCHETYPE: [number, number[]][] = [
  [CONIFER.spruce, ALL_COMPETITION],
  [CONIFER.mountain, OPEN_ONLY],
  [CONIFER.lodgepole, ALL_COMPETITION]
];

/**
 * Conifer variants: per archetype one young tree (stage 3, too young to react to the stand) and
 * one established (4) and one mature (5) tree per competition form.
 */
export const CONIFER_VARIANTS: TreeVariant[] = COMPETITION_BY_ARCHETYPE.flatMap(
  ([archetype, forms]) => [
    { form: encodeTreeForm(archetype, COMPETITION.open), stage: 3 as GrowthStage },
    ...([4, 5] as GrowthStage[]).flatMap((stage) =>
      forms.map((competition) => ({ form: encodeTreeForm(archetype, competition), stage }))
    )
  ]
);
