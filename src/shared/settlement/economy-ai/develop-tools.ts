import { METALWORKS_TYPE } from "../mixed-output";
import type { SettlementBuilding } from "../settlement-types";
import type { ResolvedBuildProgram } from "./build-program";
import { TOOL_SHORTAGE_MIN_BUILDINGS } from "./constants";
import { goalDeficit, prerequisitesMet, pullPrerequisites } from "./develop-goals";
import { type EconomyStock, economyWareIndex, freeStock } from "./economy-stock";

/**
 * Worker tools of a `develop` faction (EAI4-FOLLOWUP): its start kit's tools run out in a long game, and a producer
 * without its worker's tool stands idle. The program's Metalworks (iron + planks) makes them: its target steps pull
 * it in a grown town, and a tool shortage pulls it (and its iron chain) earlier; the economy manager sets it to
 * the tool furthest below its stock target and pauses it once every tool reaches its target.
 */

/** A goal the faction could build now (missing buildings, prerequisites finished) lacks its worker's tool. */
const lacksWorkerTool = (program: ResolvedBuildProgram) => {
  const { stock } = program.view;
  for (let index = 0; index < program.goals.length; index++) {
    const goal = program.goals[index]!;
    if (goal.tool < 0 || stock[goal.tool]! > 0) continue;
    if (goalDeficit(program, index) > 0 && prerequisitesMet(program, goal)) return true;
  }
  return false;
};

/**
 * The strategic layer's tool raise: from `TOOL_SHORTAGE_MIN_BUILDINGS` own buildings, while a buildable goal lacks
 * its worker's tool, the faction wants one toolmaking building at least, and its prerequisites with it. Raises the counts `fillWantedCounts` wrote.
 */
export const raiseToolmaking = (program: ResolvedBuildProgram) => {
  const index = program.toolmaking;
  if (index < 0 || program.view.ownBuildings < TOOL_SHORTAGE_MIN_BUILDINGS || program.view.wanted[index]! > 0 ||
    !lacksWorkerTool(program)) return;
  program.view.wanted[index] = 1;
  pullPrerequisites(program);
};

/** The output furthest below its stock target (the first on ties); undefined when every one reached it. */
const neediestOutput = (stock: EconomyStock, outputs: readonly string[], target: Int32Array) => {
  let neediest: string | undefined, largest = 0;
  for (const ware of outputs) {
    const index = economyWareIndex(ware);
    if (index < 0) continue;
    const missing = target[index]! - freeStock(stock, index);
    if (missing > largest) { largest = missing; neediest = ware; }
  }
  return neediest;
};

/**
 * The economy manager's tool order (the player's production choice lever): a running Metalworks makes the tool
 * furthest below its target; with none below, it keeps its last choice (the stock target rule pauses it).
 */
export const steerToolOutput = (
  stock: EconomyStock, building: SettlementBuilding, outputs: readonly string[], target: Int32Array
) => {
  if (building.typeId !== METALWORKS_TYPE || building.productionPaused) return;
  const neediest = neediestOutput(stock, outputs, target);
  if (neediest !== undefined) building.selectedOutput = neediest;
};
