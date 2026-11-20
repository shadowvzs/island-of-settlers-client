import { isCellDiscovered } from "../faction-discovery";
import { findFactionHome } from "../settlement-home";
import { isMineType, requiredMineOre } from "../settlement-placement";
import { settlementTerritory } from "../settlement-territory";
import type { SettlementContext } from "../settlement-types";
import type { ResolvedBuildGoal, ResolvedBuildProgram } from "./build-program";
import { EXPANSION_REFUSALS, NO_EXPANSION_TARGET } from "./constants";
import type { DevelopState } from "./develop-state";

const goalOf = (program: ResolvedBuildProgram, id: string): ResolvedBuildGoal | undefined =>
  program.goals.find(candidate => candidate.id === id);

/**
 * The planner keeps refusing a goal for want of room: `EXPANSION_REFUSALS` refusals of one goal that is no mine (a
 * mine waits for a deposit, see `expansionTarget`) and no expansion itself.
 */
const outOfRoom = (program: ResolvedBuildProgram, develop: DevelopState) => {
  for (const entry of develop.backoffs) {
    if (entry.attempts < EXPANSION_REFUSALS) continue;
    const goal = goalOf(program, entry.goal);
    if (goal && !goal.expands && !isMineType(goal.typeId)) return true;
  }
  return false;
};

/** The ore a refused mine goal needs; -1 when no mine goal waits. */
const wantedOre = (program: ResolvedBuildProgram, develop: DevelopState) => {
  for (const entry of develop.backoffs) {
    const goal = goalOf(program, entry.goal);
    if (goal && isMineType(goal.typeId)) return requiredMineOre(goal.typeId) ?? -1;
  }
  return -1;
};

/**
 * Where the faction expands to (plan §3.2: only what it discovered): the centre cell of the deposit nearest its home
 * that a refused mine goal needs, which it has seen but its land does not reach yet; `NO_EXPANSION_TARGET` when there
 * is none. A pure read of saved state, so the strategic and the planner layer agree after a reload too.
 */
export const expansionTarget = (
  context: SettlementContext, faction: number, program: ResolvedBuildProgram, develop: DevelopState
) => {
  const ore = wantedOre(program, develop);
  const home = findFactionHome(context, faction);
  const bits = develop.discovered;
  if (ore < 0 || !home || !bits) return NO_EXPANSION_TARGET;
  const { cellsX, mineZones } = context.options.world;
  const { owned } = settlementTerritory(context, faction);
  let best = NO_EXPANSION_TARGET, bestDistance = Infinity;
  for (const zone of mineZones) {
    const cell = Math.floor(zone.centreZ) * cellsX + Math.floor(zone.centreX);
    if (zone.ore !== ore || owned[cell] || !isCellDiscovered(bits, cell)) continue;
    const dx = zone.centreX - home.x, dz = zone.centreZ - home.z, distance = dx * dx + dz * dz;
    if (distance < bestDistance) { best = cell; bestDistance = distance; }
  }
  return best;
};

/**
 * Expansion (plan §4.1 `develop`, EAI4a): while a goal keeps being refused for room, or a mine goal waits for a
 * deposit the faction has seen beyond its land (`target`), it wants one more of its expansion building than it has,
 * once every one it has is finished and it has a soldier beyond one per such building to man the new one (an empty
 * garrison claims no land). Raises the count `fillWantedCounts` wrote; the planner sets the building at the edge.
 */
export const raiseExpansion = (
  program: ResolvedBuildProgram, develop: DevelopState, soldiers: number, target: number
) => {
  const index = program.expansion;
  if (index < 0) return;
  const { counts, finished, wanted } = program.view;
  const built = counts[index]!;
  if (finished[index]! < built || soldiers <= built) return;
  if (target === NO_EXPANSION_TARGET && !outOfRoom(program, develop)) return;
  wanted[index] = Math.max(wanted[index]!, built + 1);
};
