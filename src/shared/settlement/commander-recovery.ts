import { COMMANDER_LODGE_TYPE_ID } from "./building-type-ids";
import { commanderMaximumHealth, type CommanderState, isCommanderState } from "./settlement-commander";
import { isOwnBuilding } from "./settlement-home";
import type { SettlementSoldier } from "./settlement-military";
import type { SettlementActor, SettlementBuilding } from "./settlement-types";

export interface CommanderRecoveryState {
  actors:readonly SettlementActor[];
  buildings:readonly SettlementBuilding[];
  commander?:CommanderState;
  islandSeed:number;
  soldiers:readonly SettlementSoldier[];
}

/** The same preflight serves guest use, the verified server effect and live application. */
export const commanderRecoveryProblem = (state:CommanderRecoveryState, id:string) => {
  const commander=state.commander;
  if (!commander || !isCommanderState(commander) || commander.id !== id) return "The commander is unavailable";
  if (commander.homeIslandSeed !== undefined && commander.homeIslandSeed !== state.islandSeed)
    return "Return the commander to its home island first";
  const soldier=state.soldiers.find(entry=>entry.commanderId === id);
  if (!soldier?.combat || soldier.combat.faction !== 0 || !Number.isFinite(soldier.combat.hp) ||
      soldier.combat.hp < 0 || soldier.combat.hp > commanderMaximumHealth(commander.level) ||
      !state.actors.some(actor=>actor.uid === soldier.actor)) return "The commander is unavailable";
  const actor=state.actors.find(entry=>entry.uid === soldier.actor)!;
  const evacuating=commander.location === "travelling" && soldier.combat.hp === 0 && actor.phase === "commanderEvacuating";
  const incapacitated=commander.location === "incapacitated" && soldier.combat.hp === 0;
  if ((commander.location !== "recovering" && !incapacitated && !evacuating) || commander.transport)
    return "Only a defeated or recovering commander can use this item";
  if (!state.buildings.some(building=>building.uid === commander.homeLodgeUid &&
      building.typeId === COMMANDER_LODGE_TYPE_ID && building.construction === 1 &&
      isOwnBuilding(building))) return "A completed friendly Commander's Lodge is required";
  return null;
};

/** Restore the existing roster/horse identity at its lodge. No XP, combat cooldown or skill state is reset. */
export const recoverCommander = (state:CommanderRecoveryState, id:string):true|string => {
  const problem=commanderRecoveryProblem(state,id);
  if (problem) return problem;
  const commander=state.commander!;
  const soldier=state.soldiers.find(entry=>entry.commanderId === id)!;
  const actor=state.actors.find(entry=>entry.uid === soldier.actor)!;
  const lodge=state.buildings.find(entry=>entry.uid === commander.homeLodgeUid)!;
  soldier.combat!.hp=commanderMaximumHealth(commander.level);
  delete soldier.combat!.target;
  delete soldier.combat!.pendingTarget;
  delete soldier.combat!.siege;
  soldier.building=-1; soldier.stationed=false;
  Object.assign(actor,{ action:"idle",building:lodge.uid,home:lodge.uid,mounted:false,path:[],pathIndex:0,
    phase:"commanderLodge",visible:false,x:lodge.doorThreshold.x,z:lodge.doorThreshold.z,y:lodge.y });
  const mount=state.actors.find(entry=>entry.uid === soldier.combat!.mount);
  if (mount) Object.assign(mount,{ building:lodge.uid,home:lodge.uid,visible:false });
  commander.location="lodge";
  commander.recoverySeconds=0;
  commander.healingSeconds=0;
  delete commander.failureId;
  lodge.status="Resting";
  return true;
};
