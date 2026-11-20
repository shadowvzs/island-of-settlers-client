import { performance } from "node:perf_hooks";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { COMMANDER_LODGE_TYPE_ID } from "../../src/shared/settlement/building-type-ids";
import type { MilitaryCombatant, MilitaryTroopType } from "../../src/shared/settlement/military-combat-rules";
import { createMilitaryStuckRecovery } from "../../src/shared/settlement/military-stuck";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { beginPersonTrafficTick } from "../../src/shared/settlement/settlement-person-index";
import { makeBuilding } from "../../src/shared/settlement/settlement-placement";
import type { SettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../../src/shared/settlement/settlement-state-hash";
import type {
  SettlementActor, SettlementContext, SettlementPoint
} from "../../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../../src/shared/world/world-data";
import {
  createBalanceSettlement, forceTroops, spawnAround, typicalForce
} from "./garrison-balance-harness";

/**
 * Mounted hero tick bench (lane hero-mount-perf, docs/plans/hero-mount-perf-2026-11-13.md): the player's
 * commander hero is the only rider (HORSE-RETIREMENT-01). Two set pieces, each timed per simulation tick, print
 * max / p99 / top ticks and the final save hash (determinism check between base and change):
 * - `battle`: the foot battle of `military-battle-tick.ts` (64 vs 64) plus the deployed, mounted hero in the
 *   player's attack order (its first mounted flow-field build used to cost 70-90 ms in one tick);
 * - `crowd`: the mounted hero ordered into the middle of 64 idle player soldiers (it settles at their edge).
 * And `ladder`: the stuck ladder alone (no simulation), the hero penned in by a ring of idle soldiers.
 * Run: `npx tsx tools/bench/military-hero-mount-tick.ts` (`SECONDS=90`, `CASE=battle|crowd|ladder`).
 */
const SIDE = 64;
const SECONDS = Number(process.env.SECONDS ?? 90);
const CASE = process.env.CASE;
const MAP = 96;
const TICK = .05;
const HQ = { x: 10.5, z: 48.5 };
const LODGE_AT = { x: 18, z: 40 };
const PLAYER_RALLY = { x: 30, z: 48 };
const ENEMY_CAMP = { x: 62, z: 48 };
const TYPES: readonly MilitaryTroopType[] = ["shield", "heavy", "archer"];
const HERO_STOCK = { beer: 40, coins: 40, planks: 80, shield: 6, stone: 80, sword: 6, wine: 40 };

const heroSettlement = () => createBalanceSettlement(MAP, 7, HQ, undefined,
  { developmentAllowed: true, initialSettlers: 2, initialStock: HERO_STOCK, playerLevel: () => 23 });

/** Recruits the hero at a lodge by the headquarters and puts it, mounted, into the field at `at`. */
const fieldMountedHero = (
  simulation: SettlementSimulation, roads: ReturnType<typeof heroSettlement>["roads"], at: SettlementPoint
) => {
  const [width, depth] = getBuildingDefinition(COMMANDER_LODGE_TYPE_ID).gridFootprint;
  const placed = simulation.placeBuilding(COMMANDER_LODGE_TYPE_ID, LODGE_AT.x + width / 2, LODGE_AT.z + depth / 2);
  if (!placed.ok || !placed.building) throw new Error(placed.reason);
  Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
  if (!roads.addRoad(simulation.headquarters.access, placed.building.access)) throw new Error("No lodge road");
  const recruited = simulation.recruitCommander(placed.building.uid);
  if (!recruited.ok) throw new Error(recruited.reason);
  const saved = simulation.saveState();
  const soldier = saved.military!.soldiers.find(entry => entry.commanderId)!;
  const actor = saved.actors.find(entry => entry.uid === soldier.actor)!;
  soldier.building = -3;
  Object.assign(actor, { building: placed.building.uid, mounted: true, path: [], pathIndex: 0,
    phase: "militaryField", visible: true, x: at.x, z: at.z });
  saved.military!.commander = { ...saved.military!.commander!, location: "field" };
  if (!simulation.loadState(saved).ok) throw new Error("Hero deployment refused");
  return soldier.actor;
};

const deployPlayer = (simulation: SettlementSimulation) => {
  simulation.receiveTroops(forceTroops(typicalForce(SIDE, { archers: true })));
  simulation.callOutMilitary([...TYPES], PLAYER_RALLY);
  for (let second = 0; second < 120; second++) simulation.update(1);
};

const playerField = (simulation: SettlementSimulation) => {
  const bodies = new Map(simulation.frames().map(actor => [actor.uid, actor]));
  return simulation.militarySoldiers().filter(soldier => (soldier.combat?.faction ?? 0) === 0 &&
    bodies.get(soldier.actor)?.phase === "militaryField").map(soldier => soldier.actor);
};

const battleCase = () => {
  const { roads, simulation } = heroSettlement();
  deployPlayer(simulation);
  fieldMountedHero(simulation, roads, { x: PLAYER_RALLY.x - 4, z: PLAYER_RALLY.z });
  const enemies = forceTroops(typicalForce(SIDE, { archers: true })).map((troop, index) => spawnAround(simulation,
    { x: ENEMY_CAMP.x + (index % 8) * 1.2 - 4, z: ENEMY_CAMP.z + Math.floor(index / 8) * 1.2 - 4 }, troop.type));
  simulation.commandMilitaryOpponent(enemies, PLAYER_RALLY, 1, "attackMove");
  simulation.commandMilitary(playerField(simulation), ENEMY_CAMP, "attackMove");
  return simulation;
};

const crowdCase = () => {
  const { roads, simulation } = heroSettlement();
  deployPlayer(simulation);
  const hero = fieldMountedHero(simulation, roads, { x: PLAYER_RALLY.x + 24, z: PLAYER_RALLY.z + 6 });
  simulation.commandMilitary([hero], PLAYER_RALLY, "move");
  return simulation;
};

/** A flat 64-tile island with a few finished buildings (a plain navigation context, no simulation). */
const ladderContext = () => {
  const size = 64, world = { seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 8, z: 8 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      scale: new Float32Array() } } as unknown as WorldData;
  const context = { options: { world, roads: createRoadNetwork(world) }, buildings: [], actors: [],
    nextBuilding: 1, occupied: new Uint8Array(size ** 2), playerNation: "roman",
    reservations: new Set(), navigationRevision: 0 } as unknown as SettlementContext;
  for (const [typeId, x, z] of [[0, 22, 22], [62, 30, 21], [17, 22, 31], [17, 36, 30]] as const) {
    const building = makeBuilding(context, typeId, x, z, 0);
    building.construction = 1;
    context.buildings.push(building);
    for (let cz = building.z - building.depth / 2; cz < building.z + building.depth / 2; cz++)
      for (let cx = building.x - building.width / 2; cx < building.x + building.width / 2; cx++)
        context.occupied[cz * size + cx] = 1;
  }
  return context;
};
const fieldBody = (uid: number, x: number, z: number, mounted: boolean) => ({ action: mounted ? "walk" : "idle",
  building: 0, home: 0, job: "Soldier", mounted, path: [], pathIndex: 0, phase: "militaryField", uid, visible: true,
  x, yaw: 0, z }) as unknown as SettlementActor;
/**
 * The stuck ladder's worst cases for the mounted hero: penned in by a ring of idle soldiers (radius 10) with
 * its order's target 14 tiles away, either occupied by a soldier (the free-spot searches) or open (the
 * re-plan search), all failing at their budgets. Times each recovery update (the L3 step lands 5 s in).
 */
const ladderCase = (occupied: boolean) => {
  const context = ladderContext(), centre = { x: 28, z: 40 }, target = { x: 42, z: 40 };
  const hero = fieldBody(1, centre.x, centre.z, true);
  context.actors.push(hero);
  if (occupied) context.actors.push(fieldBody(2, target.x, target.z, false));
  for (let index = 0; index < 68; index++) {
    const angle = index * Math.PI * 2 / 68;
    context.actors.push(fieldBody(10 + index, centre.x + Math.cos(angle) * 10, centre.z + Math.sin(angle) * 10, false));
  }
  const recovery = createMilitaryStuckRecovery(context);
  const state = { cooldown: 0, destination: { ...target }, faction: 0, hp: 100, type: "cavalry" } as MilitaryCombatant;
  const spans: Array<{ ms: number; tick: number }> = [];
  for (let tick = 0; tick < 12 / TICK; tick++) {
    beginPersonTrafficTick(context);
    recovery.beginTick();
    const started = performance.now();
    recovery.update(hero, state, TICK);
    spans.push({ ms: performance.now() - started, tick });
  }
  const top = spans.slice().sort((a, b) => b.ms - a.ms).slice(0, 3).map(span => `${span.tick}:${span.ms.toFixed(1)}`);
  console.log(`ladder (${occupied ? "occupied" : "open"} target): max ${top.join(" ")} ms; ` +
    `path ${hero.path.length} points, destination ${state.destination?.x.toFixed(2)}, ` +
    `${state.destination?.z.toFixed(2)}`);
};

const percentile = (sorted: readonly number[], share: number) => sorted[Math.floor(sorted.length * share)] ?? 0;

const run = (label: string, simulation: SettlementSimulation) => {
  const spans: Array<{ ms: number; tick: number }> = [];
  for (let tick = 0; tick < SECONDS / TICK; tick++) {
    const started = performance.now();
    simulation.update(TICK);
    spans.push({ ms: performance.now() - started, tick });
  }
  const sorted = spans.map(span => span.ms).sort((a, b) => a - b);
  const top = spans.slice().sort((a, b) => b.ms - a.ms).slice(0, 5)
    .map(span => `${span.tick}:${span.ms.toFixed(1)}`).join(" ");
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  console.log(`${label}: avg ${mean.toFixed(2)} p99 ${percentile(sorted, .99).toFixed(2)} ` +
    `max ${(sorted.at(-1) ?? 0).toFixed(1)} ms; top ${top}; hash ${hashText(canonicalJson(simulation.saveState()))}`);
};

if (!CASE || CASE === "battle") run("battle", battleCase());
if (!CASE || CASE === "crowd") run("crowd", crowdCase());
// Twice: the first round also evaluates the building navigation recipes (a one-off cache fill).
if (!CASE || CASE === "ladder") for (const occupied of [true, false, true, false]) ladderCase(occupied);
