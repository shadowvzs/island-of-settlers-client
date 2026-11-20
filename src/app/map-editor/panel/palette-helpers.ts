import type { I18n } from "@lingui/core";

import { getStageAge, LIFE_STAGE, type LifeStage } from "../../../render-common/wildlife/wildlife-stages";
import { TREE_GROWTH_SECONDS } from "../../../shared/balance/economy";
import { contentDescriptor } from "../../../shared/i18n/content-text";
import { displayNationName } from "../../../shared/i18n/domain";
import { translateMessage } from "../../../shared/i18n/translate";
import { DEFAULT_AUTHORED_ANIMAL_AGE } from "../../../shared/world/authored-animals";
import { ISLAND_THEMES } from "../../../shared/world/generation/island-themes";
import { coverKindAssociations } from "../../../shared/world/nation-terrain-affinity";
import { PROP } from "../../../shared/world/world-data";
import type { EditorState } from "../editor-store";
import { editorMessage, MAP_EDITOR_MESSAGES as M } from "../messages";
import type { FieldOption } from "../section-store";

/** Biome painting choices: the island themes by index. */
export const BIOME_OPTIONS: readonly FieldOption[] =
  ISLAND_THEMES.map((theme, index) => ({ label: M.option.biome[theme], value: String(index) }));

/**
 * The Tiles section's help text: every grass/cover kind with the nations whose homeland typically grows it
 * (NATION-TERRAIN). The map editor has no grass-kind buttons yet; BIOME-GRASS adds them beside this text.
 */
export const getCoverNationsInfo = (i18n?: I18n) =>
  coverKindAssociations().map(({ name, nations }) => {
    const nationNames = nations.map(nation => displayNationName(nation, i18n)).join(", ");
    return `${translateMessage(i18n, contentDescriptor(name))}: ${nationNames}`;
  }).join(" · ");

const TREE_AGES = [
  [M.option.treeAge.sprout, 0], [M.option.treeAge.sapling, TREE_GROWTH_SECONDS / 4],
  [M.option.treeAge.young, TREE_GROWTH_SECONDS / 2], [M.option.treeAge.established, TREE_GROWTH_SECONDS * 3 / 4],
  [M.option.treeAge.mature, TREE_GROWTH_SECONDS]
] as const;

/**
 * Initial tree ages: real lifecycle states, not model scaling. Each age starts its growth stage
 * (`getGrowthState`): stage 1 sprout, 2 sapling, 3 young, 4 established, then the mature tree.
 */
export const TREE_AGE_OPTIONS: readonly FieldOption[] = TREE_AGES
  .map(([message, seconds]) => ({ label: editorMessage(message, { seconds }), value: String(seconds) }));

/** Initial animal ages: the wildlife's own life stages (adults at the authored default age). */
export const ANIMAL_AGE_OPTIONS: readonly FieldOption[] = ([
  [M.option.animalAge.newborn, LIFE_STAGE.newborn],
  [M.option.animalAge.juvenile, LIFE_STAGE.juvenile],
  [M.option.animalAge.adolescent, LIFE_STAGE.adolescent],
  [M.option.animalAge.adult, LIFE_STAGE.adult],
  [M.option.animalAge.mature, LIFE_STAGE.mature]
] as const).map(([label, stage]) => ({
  label,
  value: String(stage === LIFE_STAGE.adult ? DEFAULT_AUTHORED_ANIMAL_AGE : getStageAge(stage as LifeStage))
}));

const SEEDED_VARIETY: FieldOption = { label: M.option.timber.seededVariety, value: "-1" };
const VARIANTS: readonly FieldOption[] = [
  { label: M.option.timber.variant1, value: "0" },
  { label: M.option.timber.variant2, value: "1" },
  { label: M.option.timber.variant3, value: "2" },
  { label: M.option.timber.variant4, value: "3" }
];
const BIRCH_FORMS: readonly FieldOption[] = [
  { label: M.option.timber.birchYoung, value: "4" },
  { label: M.option.timber.birchMultipleStems, value: "5" },
  { label: M.option.timber.birchClassic, value: "6" },
  { label: M.option.timber.birchWeeping, value: "7" },
  { label: M.option.timber.birchOld, value: "8" }
];
const TIMBER_KINDS: ReadonlySet<number> = new Set([PROP.hardwoodTree, PROP.mahoganyTree, PROP.walnutTree]);

/**
 * The timber appearance choice of the picked tree: hardwood adds the birch forms; the field shows only
 * for hardwood, mahogany and walnut; an appearance the kind lacks shows as seeded variety.
 */
export const getTimberAppearance = ({ hardwoodForm, tool }: Pick<EditorState, "hardwoodForm" | "tool">) => {
  const kind = tool?.kind === "tree" ? tool.value : -1;
  const hardwood = kind === PROP.hardwoodTree;
  const options = hardwood ? [SEEDED_VARIETY, ...VARIANTS, ...BIRCH_FORMS] : [SEEDED_VARIETY, ...VARIANTS];
  return {
    hidden: !TIMBER_KINDS.has(kind),
    options,
    value: String(hardwoodForm < options.length - 1 ? hardwoodForm : -1)
  };
};

/** The local-biome tree button is pressed while it is the picked tool. */
export const isLocalBiomeTree = (tool: EditorState["tool"]) => tool?.kind === "tree" && tool.value === -1;
