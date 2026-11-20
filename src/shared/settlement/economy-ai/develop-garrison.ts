import { GARRISON_CAPACITIES } from "../../balance/military";
import { REFERENCE_SOLDIER } from "../commander/known-sites";
import { isFinished } from "../commander/strategic-intents";
import { militaryBuildingCapacity } from "../military-garrison-rules";
import { ownerOf } from "../settlement-ownership";
import type { SettlementBuilding, SettlementContext } from "../settlement-types";
import { GARRISON_PASSES, SOLDIERS_PER_GARRISON_DECISION } from "./constants";

/** A finished garrison building of the faction (tower, barracks, catapult). */
export const isOwnGarrison = (building: SettlementBuilding, faction: number) =>
  building.construction === 1 && ownerOf(building) === faction && GARRISON_CAPACITIES[building.typeId] !== undefined;

/**
 * The soldiers the economy AI keeps inside one of its garrison buildings (plan §3.7: the AI owns the garrison
 * targets): every place while it fortifies, else half of them (at least one, which claims the land); the rest of
 * its soldiers stay in the depot for the director's forces (A14) and new towers.
 */
export const garrisonTargetOf = (building: SettlementBuilding, fortify: boolean) => {
  const capacity = militaryBuildingCapacity(building);
  if (capacity < 1) return 0;
  return fortify ? capacity : Math.max(1, Math.ceil(capacity / 2));
};

/** The soldiers every garrison building of the faction should hold now (the economy's soldier demand). */
export const garrisonDemand = (context: SettlementContext, faction: number, fortify: boolean) => {
  let demand = 0;
  for (const building of context.buildings)
    if (isOwnGarrison(building, faction)) demand += garrisonTargetOf(building, fortify);
  return demand;
};

/** The faction's own attack or raid (EAI4b intents) is still forming or under way. */
const runsOffensive = (context: Pick<SettlementContext, "militaryDirector">, faction: number) => {
  for (const intent of context.militaryDirector?.strategy.status(faction) ?? [])
    if ((intent.kind === "attack" || intent.kind === "raid") && !isFinished(intent.status)) return true;
  return false;
};

type GarrisonContext = Pick<SettlementContext, "buildings" | "military" | "militaryDirector">;

/**
 * Soldiers the second (filling) pass may take: any while the level keeps no raid party, else only the free ones
 * (spare stored soldiers plus the uncommitted field strength in reference soldiers) beyond `raidParty` (easy's
 * raids, owner 2026-11-17).
 */
const fillAllowance = (context: GarrisonContext, faction: number, raidParty: number) => {
  if (raidParty <= 0) return Infinity;
  const stored = context.military?.spareReserve?.(faction) ?? 0;
  const field = Math.round((context.militaryDirector?.strategy.fieldStrength(faction) ?? 0) / REFERENCE_SOLDIER);
  return Math.max(0, stored + field - raidParty);
};

/**
 * The military layer's garrison step of a `develop` faction (plan §3.3, 3 s; EAI4a): its stored soldiers (else idle
 * field soldiers no A14 force holds: the director's `uncommitted` ones) walk to its garrison buildings below their
 * targets, at most `SOLDIERS_PER_GARRISON_DECISION` per decision. The first pass gives every building its first
 * soldier (an empty tower claims no land), the second fills them to their targets, in building order, leaving the
 * level's `raidParty` free; while the faction's own attack or raid runs (EAI4b) only the first pass runs, so free
 * field soldiers stay for its force. Returns the soldiers sent.
 */
export const garrisonTowers = (context: GarrisonContext, faction: number, fortify: boolean, raidParty = 0) => {
  const garrison = context.military?.garrisonFromReserve;
  if (!garrison) return 0;
  const passes = runsOffensive(context, faction) ? 1 : GARRISON_PASSES;
  let sent = 0;
  for (let pass = 0; pass < passes; pass++) {
    const limit = pass ? Math.min(SOLDIERS_PER_GARRISON_DECISION, sent + fillAllowance(context, faction, raidParty))
      : SOLDIERS_PER_GARRISON_DECISION;
    for (const building of context.buildings) {
      if (!isOwnGarrison(building, faction)) continue;
      const target = pass ? garrisonTargetOf(building, fortify) : 1;
      while (sent < limit && garrison(building.uid, target)) sent++;
      if (sent >= SOLDIERS_PER_GARRISON_DECISION) return sent;
    }
  }
  return sent;
};
