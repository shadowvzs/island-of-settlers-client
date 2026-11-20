import type { I18n } from "@lingui/core";
import { SAWMILL_RECIPES } from "@shared/catalog/balance";

import { HANDCART_LOGISTICS } from "../../../shared/balance/economy";
import { translateMessage } from "../../../shared/i18n/translate";
import { ARMORY_OUTPUTS, armoryOrder, MAX_ARMORY_ORDER } from "../../../shared/settlement/armory-orders";
import { ARMORY_TYPE_ID, SAWMILL_TYPE_ID } from "../../../shared/settlement/building-type-ids";
import { mixedProductionChoice, PRODUCTS_IN_TURN, RANDOM_TOOLS } from "../../../shared/settlement/mixed-output";
import { PRODUCTION_RULES } from "../../../shared/settlement/production-rules";
import { effectiveProductionSeconds } from "../../../shared/settlement/production-timing";
import { selectedSawmillRecipe, unlockedSawmillRecipes } from "../../../shared/settlement/sawmill-recipes";
import { shipyardRecipe } from "../../../shared/settlement/shipyard-recipes";
import { wareDisplayName } from "../../../shared/settlement/ware-names";
import { getSettlementIconSource } from "../icons";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementBuildingSummary } from "../types";

/** One of the two products a toggle switches between (Shipyard boats/ships, Sawmill planks/hand carts). */
interface ProductionToggleMode<Mode extends string> {
  /** Accessible help shown as the button's tooltip and beside the selected mode. */
  description?: string;
  icon: string;
  label: string;
  value: Mode;
}
type ToggleModes<Mode extends string> = readonly [ProductionToggleMode<Mode>, ProductionToggleMode<Mode>];

export const getShipyardModes = (i18n?: I18n) => [
  {
    description: translateMessage(i18n, M.details.production.boatsHelp),
    icon: "boat",
    label: translateMessage(i18n, M.details.production.boats),
    value: "boats"
  },
  {
    description: translateMessage(i18n, M.details.production.shipsHelp),
    icon: "ship",
    label: translateMessage(i18n, M.details.production.ships),
    value: "ships"
  }
] as const satisfies ToggleModes<"boats" | "ships">;
/** One prepared button of a two-mode toggle (Shipyard boats/ships, Fishery rod/boat). */
export interface ModeChoiceView<Mode extends string> {
  ariaLabel: string;
  /** Tooltip: the mode's help, or why it cannot be chosen. */
  description: string;
  /** Unavailable: announced with `aria-disabled`, kept focusable so its tooltip stays readable. */
  disabled?: true;
  iconSource: string;
  label: string;
  pressed: boolean;
  value: Mode;
}

export const getShipyardModeChoices = (
  mode: "boats" | "ships", i18n?: I18n
): ModeChoiceView<"boats" | "ships">[] => getShipyardModes(i18n).map(choice => ({
  ariaLabel: translateMessage(i18n, M.details.production.produce, { name: choice.label.toLowerCase() }),
  description: choice.description,
  iconSource: getSettlementIconSource(choice.icon),
  label: choice.label,
  pressed: choice.value === mode,
  value: choice.value
}));

/** The pressed choice's help, shown under the toggle. */
export const getSelectedModeDescription = <Mode extends string>(choices: readonly ModeChoiceView<Mode>[]) =>
  (choices.find(choice => choice.pressed) ?? choices[0])?.description ?? "";

/** Routes a click to the command unless the choice is unavailable. */
export const selectModeChoice = <Mode extends string, Result>(
  choices: readonly ModeChoiceView<Mode>[], mode: Mode, onChange: (mode: Mode) => Result
) => {
  if (choices.find(choice => choice.value === mode)?.disabled) return undefined;
  return onChange(mode);
};
/** Material counts of the selected Shipyard mode: total required, consumed at the site and stored here. */
export const getShipyardRecipeView = (building: SettlementBuildingSummary, i18n?: I18n) => {
  const mode = building.shipyardMode ?? "boats";
  const recipe = shipyardRecipe(mode);
  const consumed = building.shipyardSite ?? { cloth: 0, planks: 0 };
  const input = building.input ?? {};
  const incoming = building.incoming ?? {};
  const values = {
    cloth: consumed.cloth, clothRequired: recipe.cloth,
    incomingCloth: incoming.cloth ?? 0, incomingPlanks: incoming.planks ?? 0,
    planks: consumed.planks, planksRequired: recipe.planks,
    storedCloth: input.cloth ?? 0, storedPlanks: input.planks ?? 0
  };
  return {
    cloth: recipe.cloth,
    consumed,
    counts: [
      { consumed: consumed.planks, required: recipe.planks, ware: "planks" },
      ...(recipe.cloth > 0 ? [{ consumed: consumed.cloth, required: recipe.cloth, ware: "cloth" }] : [])
    ],
    mode,
    planks: recipe.planks,
    progress: translateMessage(i18n,
      mode === "ships" ? M.details.production.shipyardProgress : M.details.production.shipyardBoatProgress,
      values),
    requirement: translateMessage(i18n,
      mode === "ships" ? M.details.production.shipRequirement : M.details.production.boatRequirement,
      { cloth: recipe.cloth, planks: recipe.planks }),
    riggingIncomplete: mode === "ships" && consumed.planks >= 8 && consumed.cloth < recipe.cloth
      ? translateMessage(i18n, M.details.production.riggingIncomplete, values) : null,
    stored: translateMessage(i18n, M.details.production.shipyardStored, values)
  };
};

/** The toggle shows the current product's icon; a click asks for the other product. */
export const getProductionToggle = <Mode extends string>(
  modes: ToggleModes<Mode>, mode: Mode, i18n?: I18n
) => {
  const selected = modes[1].value === mode ? 1 : 0;
  const current = modes[selected], next = modes[1 - selected]!;
  return {
    icon: current.icon,
    label: translateMessage(i18n, M.details.production.toggle, {
      current: current.label, next: next.label.toLowerCase()
    }),
    next: next.value,
    pressed: selected === 1
  };
};

/** "fishingRod" → "Fishing Rod"-style (title case) caption of a production output option. */
const getOutputLabel = (ware: string) =>
  ware.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, character => character.toUpperCase());

const MIXED_PRODUCTION_LABELS = {
  [PRODUCTS_IN_TURN]: M.details.production.allInTurn,
  [RANDOM_TOOLS]: M.details.production.randomTools
} as const;

/** The selected production choice: the chosen product, else the building's mixed choice. */
const getProductionOutputValue = (building: SettlementBuildingSummary) =>
  building.selectedOutput ?? mixedProductionChoice(building.type);

/**
 * Output choice of a multi-output workshop, the preselected mixed choice first ("Random tools" at the
 * metalworks, otherwise "All products in turn"); null when the building has one output.
 */
export const getProductionOutputChoices = (type: number, i18n?: I18n) => {
  const rule = PRODUCTION_RULES[type];
  if (type === ARMORY_TYPE_ID || type === SAWMILL_TYPE_ID || !rule || rule.outputs.length < 2) return null;
  const mixed = mixedProductionChoice(type);
  return [
    { label: translateMessage(i18n, MIXED_PRODUCTION_LABELS[mixed]), value: mixed },
    ...rule.outputs.map(ware => ({ label: getOutputLabel(ware), value: ware }))
  ];
};

export const isSawmill = (building: SettlementBuildingSummary) => building.type === SAWMILL_TYPE_ID;

type SawmillRecipe = (typeof SAWMILL_RECIPES)[number];

/** Real cycle seconds of a recipe (before upgrades and talents), to one decimal. */
const sawmillRecipeSeconds = (recipe: SawmillRecipe) => {
  const seconds = effectiveProductionSeconds(PRODUCTION_RULES[SAWMILL_TYPE_ID]!.seconds, SAWMILL_TYPE_ID, recipe.output);
  return Math.round(seconds * 10) / 10;
};

const getRecipeButton = (
  recipe: SawmillRecipe, index: number, unlocked: ReadonlySet<string>, selected: string, i18n?: I18n
) => {
  const name = wareDisplayName(recipe.output);
  const disabled = !unlocked.has(recipe.output);
  return {
    disabled,
    label: translateMessage(i18n, M.details.production.produce, { name: name.toLowerCase() }),
    name,
    output: recipe.output,
    pressed: recipe.output === selected,
    title: disabled
      ? translateMessage(i18n, M.details.production.recipeLocked, { level: index + 1 })
      : translateMessage(i18n, M.details.production.recipeDetail, {
        input: wareDisplayName(recipe.input).toLowerCase(),
        output: name.toLowerCase(),
        seconds: sawmillRecipeSeconds(recipe)
      })
  };
};

/**
 * Sawmill plank recipes: manual selection persists until changed, an in-progress cycle keeps its
 * committed recipe; the status names the selected recipe's input stock.
 */
export const getSawmillRecipes = (building: SettlementBuildingSummary, i18n?: I18n) => {
  const summary = { selectedOutput: building.selectedOutput, typeId: building.type,
    workshopUpgrade: building.workshopUpgrade };
  const unlocked = new Set<string>(unlockedSawmillRecipes(summary).map(recipe => recipe.output));
  const recipe = selectedSawmillRecipe(summary);
  const handcart = building.sawmillMode === "handcart";
  const inputWare = handcart ? "logs" : recipe.input;
  const required = handcart ? HANDCART_LOGISTICS.cost.logs! : 1;
  const input = wareDisplayName(inputWare);
  const available = building.input?.[inputWare] ?? 0, incoming = building.incoming?.[inputWare] ?? 0;
  const needs = available < required;
  const values = { available, count: required, incoming, input };
  return {
    buttons: SAWMILL_RECIPES.map((entry, index) =>
      getRecipeButton(entry, index, unlocked, handcart ? "handcart" : recipe.output, i18n)),
    handcartTitle: translateMessage(i18n, M.details.production.handcartTitle, {
      logs: HANDCART_LOGISTICS.cost.logs
    }),
    input: inputWare,
    status: translateMessage(i18n,
      needs ? M.details.production.sawmillStatusNeeds : M.details.production.sawmillStatus,
      { ...values, ware: wareDisplayName(inputWare).toLowerCase() })
  };
};

/** Sawmill plank recipe radios plus the hand cart choice, in the shared output radio shape. */
export const getSawmillRecipeChoices = (
  building: SettlementBuildingSummary,
  recipes: ReturnType<typeof getSawmillRecipes>,
  handcartAvailable: boolean,
  i18n?: I18n
) => [
  ...recipes.buttons.map(button => ({
    disabled: button.disabled, label: button.label, name: button.name, selected: button.pressed,
    title: button.title, value: button.output, wares: [button.output]
  })),
  { disabled: !handcartAvailable,
    label: translateMessage(i18n, M.details.production.produce, {
      name: translateMessage(i18n, M.details.production.handcarts).toLowerCase()
    }),
    name: translateMessage(i18n, M.details.production.handcarts),
    selected: building.sawmillMode === "handcart", title: recipes.handcartTitle,
    value: "handcart", wares: ["handcart"] }
];

/** Routes a sawmill choice: hand carts switch the sawmill mode, plank recipes select the output. */
export const selectSawmillOutput = <Result>(
  output: string,
  onSelect: (ware: string) => Result,
  onSawmillMode?: (mode: "handcart") => Result
) => {
  if (output === "handcart") return onSawmillMode?.("handcart");
  return onSelect(output);
};

export const getSawmillRefused = (i18n?: I18n) =>
  translateMessage(i18n, M.details.production.sawmillRefused);

/** Armory order rows: remaining count (∞ while unlimited) and the next amount of each step. */
export const getArmoryOrders = (building: SettlementBuildingSummary) => ARMORY_OUTPUTS.map(ware => {
  const current = armoryOrder(building, ware);
  const finite = current ?? 0;
  const name = wareDisplayName(ware);
  return {
    count: current === null ? "∞" : String(current),
    decrease: Math.max(0, finite - 1),
    decreaseDisabled: current === 0,
    increase: Math.min(MAX_ARMORY_ORDER, finite + 1),
    increaseDisabled: current === MAX_ARMORY_ORDER,
    name,
    unlimited: current === null,
    unlimitedNext: current === null ? finite : null,
    ware
  };
});

export type ArmoryOrderRow = ReturnType<typeof getArmoryOrders>[number];

/** Native icon choices for an existing exclusive/mixed production selector. */
export const getOutputRadioChoices = (building: SettlementBuildingSummary, i18n?: I18n) => {
  const choices = getProductionOutputChoices(building.type, i18n);
  if (!choices) return null;
  const outputs = PRODUCTION_RULES[building.type]!.outputs;
  const selected = getProductionOutputValue(building);
  return choices.map(choice => {
    let wares = [choice.value];
    if (!outputs.includes(choice.value)) wares = outputs.slice(0, 3);
    return { label: translateMessage(i18n, M.details.production.produce, {
      name: choice.label.toLowerCase()
    }), name: choice.label, selected: selected === choice.value, value: choice.value, wares };
  });
};
