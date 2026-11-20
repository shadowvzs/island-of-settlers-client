import type { I18n } from "@lingui/core";

import { isWorkerNation } from "../../../render-common/workers/worker-appearance";
import { translateMessage } from "../../../shared/i18n/translate";
import { METALWORKS_TYPE, RANDOM_TOOLS } from "../../../shared/settlement/mixed-output";
import { getProductionRule,PRODUCTION_RULES } from "../../../shared/settlement/production-rules";
import { sawmillProductionRule } from "../../../shared/settlement/sawmill-recipes";
import { handcartCycleRule } from "../../../shared/settlement/settlement-sawmill-handcarts";
import { shipyardRecipeInputs } from "../../../shared/settlement/shipyard-recipes";
import { getInventoryCells } from "../inventory";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementBuildingSummary } from "../types";
import { getWorkProgress } from "./helpers";
import { getProductionResourceInput } from "./production-resource-input";

type WareCell = ReturnType<typeof getInventoryCells>[number];

/** Native natural-source context belongs beside real wares, without a fabricated quantity. */
export interface ProductionWareGroup {
  cells: readonly WareCell[];
  heading: string;
  label: string;
  resourceInput: { label: string; source: string } | null;
  /** The three-tool composition shown for the metalworks' random output. */
  randomTools?: readonly string[];
}

const getRecipe = (building: SettlementBuildingSummary, nation?: string) => {
  const resolvedNation = isWorkerNation(nation) ? nation : "roman";
  const base = getProductionRule(building.type, resolvedNation);
  if (!base) return undefined;
  const recipe = sawmillProductionRule({ typeId: building.type, selectedOutput: building.selectedOutput,
    workshopUpgrade: building.workshopUpgrade }, base);
  if (building.type === 33 && building.sawmillMode === "handcart")
    return { ...handcartCycleRule(recipe), outputs: [] };
  if (building.type === 36)
    return { ...recipe, inputs: shipyardRecipeInputs(building.shipyardMode), outputs: [] };
  if (building.selectedOutput && recipe.outputs.includes(building.selectedOutput))
    return { ...recipe, outputs: [building.selectedOutput] };
  return recipe;
};

/** Configured wares get real zero buffers; retained positive stocks remain visible after a recipe switch. */
const getWareGroup = (
  heading: string, label: string, inventory: Readonly<Record<string, number>> | undefined,
  configured: readonly string[], resourceInput: ProductionWareGroup["resourceInput"] = null
): ProductionWareGroup | null => {
  const stock = Object.fromEntries(configured.map(ware => [ware, inventory?.[ware] ?? 0]));
  for (const [ware, count] of Object.entries(inventory ?? {})) if (count > 0) stock[ware] = count;
  const cells = getInventoryCells(stock);
  return cells.length || resourceInput ? { cells, heading, label, resourceInput } : null;
};

/**
 * The metalworks' random mode has no single product to list: its output group shows the same
 * three-tool composition as the "Random tools" radio, with the island's total tool stock.
 */
const getRandomToolsGroup = (
  outputs: readonly string[], inventory: Readonly<Record<string, number>> | undefined, i18n?: I18n
): ProductionWareGroup => {
  const count = outputs.reduce((sum, ware) => sum + (inventory?.[ware] ?? 0), 0);
  const label = translateMessage(i18n, M.details.production.randomToolsCount, { count });
  return {
    cells: [{ count: String(count), label, name: translateMessage(i18n, M.details.production.randomTools),
      ware: RANDOM_TOOLS }],
    heading: translateMessage(i18n, M.details.production.output),
    label: translateMessage(i18n, M.details.production.producedWares),
    randomTools: outputs.slice(0, 3),
    resourceInput: null
  };
};

const isRandomTools = (building: SettlementBuildingSummary) =>
  building.type === METALWORKS_TYPE &&
  (building.selectedOutput === undefined || building.selectedOutput === RANDOM_TOOLS);

/** Actual recipe I/O or a natural source; services never show ware bubbles. */
export const getProductionWares = (
  building: SettlementBuildingSummary, showOutput = true, nation?: string, i18n?: I18n
) => {
  const recipe = getRecipe(building, nation);
  if (!recipe || recipe.service) return null;
  const resolvedNation = isWorkerNation(nation) ? nation : "roman";
  const resourceInput = recipe.inputs.length
    ? null : getProductionResourceInput(building.type, resolvedNation, i18n);
  const input = getWareGroup(
    translateMessage(i18n, M.details.production.input),
    translateMessage(i18n, M.details.production.inputWares),
    building.input, recipe.inputs, resourceInput);
  let output: ProductionWareGroup | null = null;
  if (showOutput) output = isRandomTools(building)
    ? getRandomToolsGroup(recipe.outputs, building.output, i18n)
    : getWareGroup(
      translateMessage(i18n, M.details.production.output),
      translateMessage(i18n, M.details.production.producedWares),
      building.output, recipe.outputs);
  if (!input && !output) return null;
  return { input, output, showArrow: Boolean(input && output) };
};

/**
 * A completed producer whose worker can report a work bar keeps the bar's line reserved, so the window
 * height does not jump when the bar appears or disappears (owner 2026-10-21).
 */
const reservesWorkProgress = (building: SettlementBuildingSummary) => {
  const rule = PRODUCTION_RULES[building.type];
  return Boolean(building.completed && rule && !rule.service);
};

const WORK_PROGRESS_SLOT = "settlement-ui__work-progress-slot";
const RESERVED_WORK_PROGRESS_SLOT = `${WORK_PROGRESS_SLOT} ${WORK_PROGRESS_SLOT}--reserved`;

/** The work bar (null while idle) and its slot class; a reserved slot keeps its height when empty. */
export const getWorkProgressSlot = (building: SettlementBuildingSummary, i18n?: I18n) => ({
  className: reservesWorkProgress(building) ? RESERVED_WORK_PROGRESS_SLOT : WORK_PROGRESS_SLOT,
  progress: getWorkProgress(building, i18n)
});
