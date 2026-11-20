import type { MineZone, WorldData } from "../../world/world-data";
import { isCellDiscovered } from "../faction-discovery";
import { civilianOwnerOf } from "../settlement-ownership";
import { assignSurveyJob } from "../settlement-surveying";
import type { SettlementContext } from "../settlement-types";
import { GEOLOGIST_JOB } from "./constants";
import type { DevelopState } from "./develop-state";

/** The faction knows the deposit: one of its geologists surveyed it (ascending ids, binary search). */
export const knowsDeposit = (develop: Readonly<DevelopState>, zone: number) => {
  const { deposits } = develop;
  let low = 0, high = deposits.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1, value = deposits[middle]!;
    if (value === zone) return true;
    if (value < zone) low = middle + 1; else high = middle - 1;
  }
  return false;
};

/** Records a deposit its geologist surveyed (kept ascending, once). */
export const recordDeposit = (develop: DevelopState, zone: number) => {
  if (knowsDeposit(develop, zone)) return;
  let at = develop.deposits.length;
  while (at > 0 && develop.deposits[at - 1]! > zone) at--;
  develop.deposits.splice(at, 0, zone);
};

/** The cell under a zone's mean position. */
const centreCell = (world: Pick<WorldData, "cellsX" | "cellsZ">, zone: Readonly<MineZone>) => {
  const x = Math.min(world.cellsX - 1, Math.max(0, Math.floor(zone.centreX)));
  const z = Math.min(world.cellsZ - 1, Math.max(0, Math.floor(zone.centreZ)));
  return z * world.cellsX + x;
};

/** A deposit worth a survey: not known yet, and the faction has discovered the ground at its centre. */
const unsurveyedSeen = (world: WorldData, develop: Readonly<DevelopState>, zone: Readonly<MineZone>) =>
  !knowsDeposit(develop, zone.id) && develop.discovered !== undefined &&
  isCellDiscovered(develop.discovered, centreCell(world, zone));

/** The first deposit worth a survey with an id above `after` (map order), or undefined. */
const nextDeposit = (world: WorldData, develop: Readonly<DevelopState>, after: number) => {
  for (const zone of world.mineZones) if (zone.id > after && unsurveyedSeen(world, develop, zone)) return zone;
  return undefined;
};

const geologistOut = (context: SettlementContext, faction: number) =>
  context.actors.some(actor => actor.job === GEOLOGIST_JOB && civilianOwnerOf(actor) === faction);

/**
 * The AI geologist (plan §3.2: mines need the faction's own survey, the player's rule). At most one geologist of the
 * faction is out; one decision tries one deposit: the next one after the saved survey cursor (wrapping) that is not
 * surveyed yet and whose centre ground the faction has discovered. It walks out through the player's survey job
 * (`assignSurveyJob` with the faction as owner: its storages, idle settler and tool) and records what it finds in
 * the faction's own knowledge. A refusal (no tool, no settler, no way) moves the cursor on to the next deposit.
 */
export const surveyOneDeposit = (context: SettlementContext, faction: number, develop: DevelopState) => {
  const { world } = context.options;
  if (!world.mineZones?.length || geologistOut(context, faction)) return;
  const zone = nextDeposit(world, develop, develop.surveyCursor) ?? nextDeposit(world, develop, 0);
  if (!zone) return;
  develop.surveyCursor = zone.id;
  assignSurveyJob(context, GEOLOGIST_JOB, { x: zone.centreX, z: zone.centreZ }, faction);
};
