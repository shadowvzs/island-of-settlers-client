import assert from "node:assert/strict";

import type { MilitaryTroopType } from "../../src/shared/settlement/military-combat-rules";
import type { SettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { WorldData } from "../../src/shared/world/world-data";
import { createBalanceSimulation, forceTroops, spawnAround } from "./garrison-balance-harness";

/** Outcome/continuity playtests, not a CPU benchmark: fixed armies across independent terrain cases. */
export const TYPES: MilitaryTroopType[] = ["shield", "heavy", "archer", "cavalry"];
export const FORCES = {
  melee: { shield: 16, heavy: 8 },
  mixed: { shield: 10, heavy: 6, archer: 5, cavalry: 3 },
  archers: { shield: 8, heavy: 4, archer: 12 },
  cavalry: { shield: 8, heavy: 4, cavalry: 12 }
};
export const terrains = ["open", "wide-gap", "narrow-gap"] as const;
const advance = (simulation: SettlementSimulation, seconds: number) => {
  for (let tick = 0; tick < seconds * 20; tick++) simulation.update(.05);
};
const health = (simulation: SettlementSimulation, faction: number) => simulation.militarySoldiers()
  .filter(soldier => soldier.combat?.faction === faction).reduce((sum, soldier) => sum + soldier.combat!.hp, 0);
const reload = (simulation: SettlementSimulation) => {
  const saved = simulation.saveState();
  const before = saved.military!.soldiers.map(soldier => [soldier.actor, soldier.combat?.hp, soldier.combat?.order]);
  assert.deepEqual(simulation.loadState(saved), { ok: true });
  assert.deepEqual(simulation.saveState().military!.soldiers
    .map(soldier => [soldier.actor, soldier.combat?.hp, soldier.combat?.order]), before);
};
const reshape = (terrain: typeof terrains[number]) => (world: WorldData) => {
  if (terrain === "open") return;
  const half = terrain === "wide-gap" ? 5 : 2;
  for (let z = 0; z < world.cellsZ; z++) for (let x = 45; x <= 51; x++) {
    if (Math.abs(z + .5 - 48) < half) continue;
    world.walkCost[z * world.cellsX + x] = 0;
  }
};
const survivors = (simulation: SettlementSimulation, faction: number) => simulation.militarySoldiers()
  .filter(soldier => soldier.combat?.faction === faction).length;
const nearEnemies = (simulation: SettlementSimulation) => {
  const actors = new Map(simulation.frames().map(actor => [actor.uid, actor]));
  const factions = [0, 1].map(faction => simulation.militarySoldiers().filter(s => s.combat?.faction === faction)
    .map(s => actors.get(s.actor)!).filter(Boolean));
  return factions[0]!.some(a => factions[1]!.some(b => Math.hypot(a.x - b.x, a.z - b.z) < 8));
};
export const runFieldBattle = (terrain: typeof terrains[number], composition: keyof typeof FORCES, seed: number) => {
  const simulation = createBalanceSimulation(96, seed, { x: 10.5, z: 48.5 }, reshape(terrain));
  const troops = forceTroops({ ...FORCES[composition], ranks: [0, 1, 2] });
  simulation.receiveTroops(troops);
  assert.equal(simulation.callOutMilitary(TYPES, { x: 30, z: 48 }), troops.length);
  advance(simulation, 120);
  const player = simulation.militarySoldiers().filter(soldier => soldier.combat?.faction === 0)
    .map(soldier => soldier.actor);
  const enemy = troops.map(troop => spawnAround(simulation, { x: 65, z: 48 }, troop.type, troop.rank, 1));
  assert.equal(simulation.commandMilitary(player, { x: 65, z: 48 }, "attackMove"), true);
  assert.equal(simulation.commandMilitaryOpponent(enemy, { x: 30, z: 48 }, 1, "attackMove"), true);
  const initial = health(simulation, 0) + health(simulation, 1);
  let previous = initial, noDamage = 0, longestQuietContact = 0, seconds = 0;
  for (; seconds < 300 && survivors(simulation, 0) && survivors(simulation, 1); seconds++) {
    advance(simulation, 1);
    const current = health(simulation, 0) + health(simulation, 1);
    noDamage = current < previous || !nearEnemies(simulation) ? 0 : noDamage + 1;
    longestQuietContact = Math.max(longestQuietContact, noDamage); previous = current;
    if (seconds === 20 || seconds === 60) reload(simulation);
  }
  const result = { terrain, composition, seed, seconds, player: survivors(simulation, 0),
    enemy: survivors(simulation, 1), damage: initial - previous, longestQuietContact };
  reload(simulation);
  assert(result.damage > 0, `No contact: ${JSON.stringify(result)}`);
  return { ...result, checkpoint: result.player && result.enemy ? simulation.saveState() : undefined };
};
