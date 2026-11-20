import type { MilitaryTroopType } from "../../src/shared/settlement/military-combat-rules";
import type { SettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementPoint } from "../../src/shared/settlement/settlement-types";
import type { WorldData } from "../../src/shared/world/world-data";
import {
  createBalanceSimulation,
  deployForce,
  forceTroops,
  garrisonPlan,
  placeHostileSite,
  spawnAround,
  typicalForce
} from "./garrison-balance-harness";

/**
 * Military motion scenarios (docs/archive/dated/military-motion-2026-10-13.md): deterministic, headless set pieces
 * that exercise soldier movement and close combat. Each returns the simulation, the ids it watches
 * and the order that starts it; `tools/bench/military-motion-metrics.ts` measures them.
 * Computer factions 1 and 2 fight each other, so no deployment from a storage is needed (except the
 * siege, which needs the player's siege order).
 */
export interface MotionScenario {
  name: string;
  simulation: SettlementSimulation;
  /** Game seconds measured after `start`. */
  seconds: number;
  /** Map tiles shown on the frame sheets: [minX, minZ, maxX, maxZ]. */
  view: readonly [number, number, number, number];
  start: () => void;
  /** Blocked cells drawn on the frame sheets (walls, sea). */
  blocked: (x: number, z: number) => boolean;
  /** Group order scenarios: soldiers end the scenario standing at their places. */
  marching: boolean;
}

const HQ_CORNER = { x: 6.5, z: 6.5 };
const FOOT_SPACING = 0.9;
const ARCHER_SPACING = 1;
const RIDER_SPACING = 2.4;

export const spawnAt = (
  simulation: SettlementSimulation,
  point: SettlementPoint,
  type: MilitaryTroopType,
  faction: number
) =>
  simulation.spawnMilitaryOpponent(point, type, 0, faction) ??
  spawnAround(simulation, point, type, 0, faction);

/** Rows across the facing direction (`facing` +1: east, -1: west), front row first. */
export const spawnRows = (
  simulation: SettlementSimulation,
  centre: SettlementPoint,
  facing: number,
  types: readonly MilitaryTroopType[],
  perRow: number,
  spacing: number,
  faction = 1
) =>
  types.map((type, index) => {
    const row = Math.floor(index / perRow),
      column = index % perRow;
    const across = (column - (Math.min(perRow, types.length) - 1) / 2) * spacing;
    return spawnAt(
      simulation,
      { x: centre.x - facing * row * spacing, z: centre.z + across },
      type,
      faction
    );
  });

export const typesOf = (force: ReturnType<typeof typicalForce>, kinds: readonly MilitaryTroopType[]) =>
  forceTroops(force)
    .map((troop) => troop.type)
    .filter((type) => kinds.includes(type));

/**
 * An army in battle order: the foot block in front, archers behind it, riders in two wings (`riders`: the
 * historical mounted mix; ordinary cavalry is retired, HORSE-RETIREMENT-01). `facing` +1: faction 1 facing
 * east; -1: faction 2 facing west.
 */
const spawnArmy = (
  simulation: SettlementSimulation,
  centre: SettlementPoint,
  facing: number,
  size: number,
  riders: boolean
) => {
  const faction = facing > 0 ? 1 : 2;
  const force = typicalForce(size, { archers: true, cavalry: riders });
  const foot = typesOf(force, ["shield", "heavy"]),
    archers = typesOf(force, ["archer"]);
  const mounted = typesOf(force, ["cavalry"]);
  const perRow = 10,
    footDepth = Math.ceil(foot.length / perRow) * FOOT_SPACING;
  const ids = spawnRows(simulation, centre, facing, foot, perRow, FOOT_SPACING, faction);
  const archerCentre = { x: centre.x - facing * (footDepth + 1), z: centre.z };
  ids.push(
    ...spawnRows(simulation, archerCentre, facing, archers, perRow, ARCHER_SPACING, faction)
  );
  const half = Math.ceil(mounted.length / 2),
    wingOffset = (perRow / 2) * FOOT_SPACING + 3;
  for (const [wing, side] of [
    [mounted.slice(0, half), -1],
    [mounted.slice(half), 1]
  ] as const) {
    const wingCentre = { x: centre.x - facing * RIDER_SPACING, z: centre.z + side * wingOffset };
    ids.push(...spawnRows(simulation, wingCentre, facing, wing, 2, RIDER_SPACING, faction));
  }
  return ids;
};

export const openBlocked = () => false;

/** Every `cavalryEvery`-th index (at `cavalryAt`) rides; every `archerEvery`-th (at `archerAt`) shoots. */
const mixedTroopType = (
  index: number,
  cavalryEvery: number,
  cavalryAt: number,
  archerEvery: number,
  archerAt: number
): MilitaryTroopType => {
  if (index % cavalryEvery === cavalryAt) return "cavalry";
  return index % archerEvery === archerAt ? "archer" : "shield";
};

/**
 * 64 vs 64 mixed armies meet on open ground, both attack-moving on the other's centre. `riders` keeps the
 * historical mounted wings of the motion regression fixtures; the A14 fixtures fight on foot. `seed`: the
 * island seed (the A14 gates run several).
 */
export const fieldBattleScenario = (size = 64, seconds = 75, riders = true, seed = 7): MotionScenario => {
  const simulation = createBalanceSimulation(96, seed, HQ_CORNER);
  const west = { x: 34, z: 48 },
    east = { x: 62, z: 48 };
  const one = spawnArmy(simulation, west, 1, size, riders),
    two = spawnArmy(simulation, east, -1, size, riders);
  return {
    blocked: openBlocked,
    marching: false,
    name: `field ${size}v${size}`,
    seconds,
    simulation,
    start: () => {
      simulation.commandMilitaryOpponent(one, east, 1, "attackMove");
      simulation.commandMilitaryOpponent(two, west, 2, "attackMove");
    },
    view: [24, 30, 72, 66]
  };
};

/** Two mixed columns of one side swap places head on (opposite streams), plain move orders. */
export const headOnScenario = (size = 20, seconds = 45): MotionScenario => {
  const simulation = createBalanceSimulation(96, 11, HQ_CORNER);
  const west = { x: 30, z: 48 },
    east = { x: 66, z: 48 };
  const types = (count: number) =>
    Array.from({ length: count }, (_, index): MilitaryTroopType =>
      mixedTroopType(index, 5, 4, 3, 2)
    );
  const one = spawnRows(simulation, west, 1, types(size), 5, 1.2);
  const two = spawnRows(simulation, east, -1, types(size), 5, 1.2);
  return {
    blocked: openBlocked,
    marching: true,
    name: `head-on ${size}+${size}`,
    seconds,
    simulation,
    start: () => {
      simulation.commandMilitaryOpponent(one, east, 1, "move");
      simulation.commandMilitaryOpponent(two, west, 1, "move");
    },
    view: [22, 36, 74, 60]
  };
};

/** Two foot columns of one side cross at right angles in the middle of the field. */
export const crossingScenario = (size = 24, seconds = 45): MotionScenario => {
  const simulation = createBalanceSimulation(96, 13, HQ_CORNER);
  const one = spawnRows(simulation, { x: 30, z: 48 }, 1, Array(size).fill("shield"), 4, 1);
  const two = Array.from({ length: size }, (_, index) =>
    spawnAt(simulation, { x: 48 + ((index % 4) - 1.5), z: 30 - Math.floor(index / 4) }, "shield", 1)
  );
  return {
    blocked: openBlocked,
    marching: true,
    name: `crossing ${size}x${size}`,
    seconds,
    simulation,
    start: () => {
      simulation.commandMilitaryOpponent(one, { x: 66, z: 48 }, 1, "move");
      simulation.commandMilitaryOpponent(two, { x: 48, z: 66 }, 1, "move");
    },
    view: [24, 24, 72, 72]
  };
};

const GATE_X = 47;
const GATE = { from: 46, to: 50 };
/** A wall across the map with one gate four tiles wide. */
const isGateWall = (x: number, z: number) =>
  (x === GATE_X || x === GATE_X + 1) && (z < GATE.from || z >= GATE.to);
const carveGate = (world: WorldData) => {
  for (let z = 0; z < world.cellsZ; z++)
    for (let x = 0; x < world.cellsX; x++)
      if (isGateWall(x, z)) world.walkCost[z * world.cellsX + x] = 0;
};

/** A mixed army marches through a four-tile gate in a wall. */
export const gateScenario = (size = 32, seconds = 60): MotionScenario => {
  const simulation = createBalanceSimulation(96, 17, HQ_CORNER, carveGate);
  const types = Array.from({ length: size }, (_, index): MilitaryTroopType =>
    mixedTroopType(index, 8, 7, 4, 1)
  );
  const ids = spawnRows(simulation, { x: 36, z: 48 }, 1, types, 6, 1.3);
  return {
    blocked: isGateWall,
    marching: true,
    name: `gate march ${size}`,
    seconds,
    simulation,
    start: () => {
      simulation.commandMilitaryOpponent(ids, { x: 62, z: 48 }, 1, "move");
    },
    view: [24, 34, 72, 62]
  };
};

/** The player's foot melee and riders besiege a manned watchtower; archers support from its front. */
export const siegeScenario = (seconds = 90): MotionScenario => {
  const simulation = createBalanceSimulation(64, 5, HQ_CORNER);
  const site = placeHostileSite(simulation, 4, 40, 40);
  const plan = garrisonPlan(4, [0]);
  const guards = plan.troops.map((type, index) =>
    spawnAround(simulation, site.access, type, plan.ranks[index])
  );
  if (!simulation.registerMilitaryGarrison(site.uid, guards, 1, plan.doorHp))
    throw new Error("Garrison refused");
  deployForce(
    simulation,
    { archer: 4, cavalry: 4, heavy: 4, ranks: [0], shield: 10 },
    { x: 24, z: 24 }
  );
  const ours = (type: MilitaryTroopType) =>
    simulation
      .militarySoldiers()
      .filter((soldier) => (soldier.combat?.faction ?? 0) === 0 && soldier.combat?.type === type)
      .map((soldier) => soldier.actor);
  const dx = site.access.x - site.x,
    dz = site.access.z - site.z,
    length = Math.hypot(dx, dz) || 1;
  const standoff = { x: site.access.x + (dx / length) * 5, z: site.access.z + (dz / length) * 5 };
  return {
    blocked: (x, z) => simulation.isOccupied(x, z),
    marching: false,
    name: "siege door",
    seconds,
    simulation,
    start: () => {
      simulation.siegeMilitary([...ours("shield"), ...ours("heavy"), ...ours("cavalry")], site.uid);
      simulation.commandMilitary(ours("archer"), standoff, "attackMove");
    },
    view: [20, 20, 52, 52]
  };
};

export const MOTION_SCENARIOS = {
  crossing: crossingScenario,
  field: fieldBattleScenario,
  gate: gateScenario,
  headOn: headOnScenario,
  siege: siegeScenario
} as const;
