import type { SettlementSaveV1 } from "../../src/shared/settlement/settlement-save-state";
import type { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";

type Simulation = ReturnType<typeof createSettlementSimulation>;

/** The save without enemy soldiers (and their horses), as if the conquest had killed them all. */
const withoutEnemySoldiers = (state: SettlementSaveV1): SettlementSaveV1 => {
  const enemies = state.military?.soldiers.filter(soldier => (soldier.combat?.faction ?? 0) > 0) ?? [];
  const removed = new Set(enemies.flatMap(soldier => [soldier.actor, soldier.combat?.mount ?? -1]));
  return { ...state, actors: state.actors.filter(actor => !removed.has(actor.uid)),
    military: state.military && { ...state.military,
      // Movement groups and owners of the removed enemies would point at missing soldiers.
      combat: state.military.combat && { ...state.military.combat, movement: undefined },
      soldiers: state.military.soldiers.filter(soldier => !enemies.includes(soldier)) } };
};

/** Removes every enemy soldier and horse through a save round trip (test and tool fixtures only). */
export const clearEnemySoldiers = (simulation: Simulation) => {
  const loaded = simulation.loadState(withoutEnemySoldiers(simulation.saveState()));
  if (!loaded.ok) throw new Error(`clearing enemy soldiers: ${loaded.reason}`);
};

/**
 * Fakes a colony conquest for fixtures about what follows it. A removed fort's garrison comes out
 * and keeps fighting, and a colony is conquered only when no enemy soldier is alive (owner
 * 2026-11-09), so the garrisons are cleared before their forts are removed.
 */
export const fakeColonyConquest = (simulation: Simulation) => {
  clearEnemySoldiers(simulation);
  for (const fort of simulation.buildings().filter(building => (building.militaryFaction ?? 0) > 0)) {
    const removed = simulation.removeMilitaryScenarioBuilding(fort.uid);
    if (!removed.ok) throw new Error(`removing fort ${fort.uid}: ${removed.reason}`);
  }
  for (let tick = 0; tick < 20; tick++) simulation.update(.05);
  if (simulation.colony()?.status !== "conquered") throw new Error("the faked colony conquest did not hold");
};
