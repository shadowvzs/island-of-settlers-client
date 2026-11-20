import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { exposedGarrisonFigure, garrisonSlots } from "../../src/render-common/buildings/military-garrison-slots";
import { GARRISON_CAPACITIES } from "../../src/shared/balance/military";
import type { ColonyDifficulty, ColonyIsland } from "../../src/shared/settlement/colony-expedition-rules";
import { EXPEDITION_ISLAND_SIZE, fortPlans } from "../../src/shared/settlement/colony-island-rules";
import { type DifficultyLevel, isDifficultyLevel } from "../../src/shared/settlement/difficulty";
import { buildingStructure } from "../../src/shared/settlement/fort-assault-rules";
import { militaryHealth, type MilitaryTroopType } from "../../src/shared/settlement/military-combat-rules";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation, type SettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type {
  SettlementBuilding, SettlementOptions, SettlementPoint
} from "../../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../../src/shared/world/world-data";

/**
 * Deterministic siege and garrison balance harness (docs/contracts/settlement-military-contract.md, "Balance").
 * Every run is a real settlement simulation on a flat island; the seed drives the combat dice
 * (the military random state starts from the world seed). Used by `tests/garrison-balance.test.ts`
 * and `tools/bench/garrison-balance.ts`.
 */
export type ForceSpec = Readonly<Partial<Record<MilitaryTroopType, number>>> & { ranks: readonly number[] };
export interface AssaultOutcome {
  won: boolean;
  /** Player soldiers sent and lost. */
  force: number;
  losses: number;
  /** Losses before the first siege (in the field); the rest fell at the forts. */
  fieldLosses: number;
  /** Game seconds from the first order to victory (or to the end of the run). */
  seconds: number;
  /** Enemy soldiers on the island when the assault starts (colony assaults). */
  enemies?: number;
}
export interface BalanceSummary {
  runs: number;
  winRate: number;
  /** Mean soldiers lost and mean share of the force lost. */
  meanLosses: number;
  meanFieldLosses: number;
  lossShare: number;
  /** Mean game seconds of the won runs (null without a win). */
  meanWinSeconds: number | null;
}

/** Seeds of every balance case (at least ten each). */
export const BALANCE_SEEDS: readonly number[] = Array.from({ length: 10 }, (_, index) => index + 1);
export const MILITARY_BUILDING_NAMES: Readonly<Record<number, string>> = {
  1: "Barracks", 2: "Guardhouse", 4: "Watchtower", 9: "Fortress"
};
const FOOT_MELEE: readonly MilitaryTroopType[] = ["shield", "heavy"];
const ALL_TYPES: readonly MilitaryTroopType[] = ["shield", "heavy", "archer", "cavalry"];
const GARRISON_MAP_SIZE = 64;
const FIELD_ORDER_SECONDS = 10;
const DEPLOY_SECONDS = 120;
/** A typical player force: a third of the melee are axemen; archers and riders are optional support. */
const ARCHER_SHARE = .2;
const CAVALRY_SHARE = .15;
const AXEMAN_SHARE = 1 / 3;
/** Supporting archers stand this far in front of the door: past the dead zone, inside bow range of the posts. */
const ARCHER_STANDOFF = 5;
/** Besieging soldiers: foot melee queue at the door; riders hunt reinforcements and may fight on foot there. */
const BESIEGERS: readonly MilitaryTroopType[] = [...FOOT_MELEE, "cavalry"];
/** Simulation steps per second of the wall assault timing. */
const WALL_STEPS_PER_SECOND = 10;
/**
 * Game-clock start of every balance island (UTC 2026-11-01): the discovery calendar reads the month, so a pinned
 * start keeps scenario hashes independent of the day the test runs (they were recorded in November 2026).
 */
const BALANCE_CLOCK_START = Date.UTC(2026, 10, 1);

const flatWorld = (size: number, seed: number, start: SettlementPoint) => ({
  seed, cellsX: size, cellsZ: size, seaLevel: -1, start,
  heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
  walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
  oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
  props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
}) as unknown as WorldData;

type BalanceOptions = Pick<SettlementOptions, "developmentAllowed" | "difficulty" | "initialSettlers" |
  "initialStock" | "onMilitaryDirector" | "playerLevel" | "withoutMilitaryCommander">;

/**
 * The global difficulty of every balance settlement made from here on (A14-5: Hard plays the hard commander
 * profile, Very hard the faster one). Benches set it with `DIFFICULTY=hard|veryHard`; absent: Normal.
 */
let balanceDifficulty: DifficultyLevel | undefined =
  isDifficultyLevel(process.env.DIFFICULTY) ? process.env.DIFFICULTY : undefined;

/** Runs `run` with every balance settlement it makes at the global difficulty `level`. */
export const withBalanceDifficulty = <Result>(level: DifficultyLevel, run: () => Result): Result => {
  const previous = balanceDifficulty;
  balanceDifficulty = level;
  try {
    return run();
  } finally {
    balanceDifficulty = previous;
  }
};

/** A settlement on a flat island with its road network (fixtures that lay roads, e.g. to a commander's lodge). */
export const createBalanceSettlement = (
  size: number, seed: number, start: SettlementPoint = { x: 6.5, z: 6.5 }, shape?: (world: WorldData) => void,
  options: BalanceOptions = {}
) => {
  const world = flatWorld(size, seed, start);
  shape?.(world);
  let simulation: SettlementSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, clockStart: BALANCE_CLOCK_START,
    difficulty: balanceDifficulty, initialSettlers: 0, initialStock: { planks: 80, stone: 80 }, roads, world,
    ...options });
  return { roads, simulation };
};

/** A settlement on a flat island (reshaped by `shape`, e.g. carved sea); its headquarters stands at `start`. */
export const createBalanceSimulation = (
  size: number, seed: number, start: SettlementPoint = { x: 6.5, z: 6.5 }, shape?: (world: WorldData) => void,
  options: BalanceOptions = {}
) => createBalanceSettlement(size, seed, start, shape, options).simulation;

/** A finished building of `typeId` centred on the grid near (x, z). */
export const placeFinished = (simulation: SettlementSimulation, typeId: number, x: number, z: number) => {
  const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
  const result = simulation.placeBuilding(typeId, x + width % 2 / 2, z + depth % 2 / 2);
  if (!result.ok || !result.building) throw new Error(result.reason);
  Object.assign(result.building, { construction: 1, foundationProgress: 1, required: {} });
  return result.building;
};

/** A finished hostile fort of `typeId` near (x, z), placed like the game's forts (outside player territory). */
export const placeHostileSite = (simulation: SettlementSimulation, typeId: number, x: number, z: number) => {
  const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
  const result = simulation.placeMilitaryScenarioBuilding(typeId, x + width % 2 / 2, z + depth % 2 / 2);
  if (!result.ok) throw new Error(result.reason);
  return result.building;
};

/** One soldier of `faction` on the first free point in rings around `centre` (like `spawnHostileNear`). */
export const spawnAround = (
  simulation: SettlementSimulation, centre: SettlementPoint, type: MilitaryTroopType, rank = 0, faction = 1
) => {
  for (let ring = 1; ring <= 6; ring++) for (let step = 0; step < 16; step++) {
    const angle = step * Math.PI / 8;
    const id = simulation.spawnMilitaryOpponent({ x: centre.x + Math.cos(angle) * ring * .8,
      z: centre.z + Math.sin(angle) * ring * .8 }, type, rank, faction);
    if (id !== null) return id;
  }
  throw new Error("No room to spawn a soldier");
};

/** Interleaved troops of a force; ranks cycle through `ranks` in that order. */
export const forceTroops = (force: ForceSpec) => {
  const left = new Map(ALL_TYPES.map(type => [type, force[type] ?? 0]));
  const troops: Array<{ hp: number; rank: number; type: MilitaryTroopType }> = [];
  while ([...left.values()].some(count => count > 0)) for (const type of ALL_TYPES) {
    if (!left.get(type)) continue;
    left.set(type, left.get(type)! - 1);
    const rank = force.ranks[troops.length % force.ranks.length]!;
    troops.push({ hp: militaryHealth(type, rank), rank, type });
  }
  return troops;
};

export const forceSize = (force: ForceSpec) => ALL_TYPES.reduce((sum, type) => sum + (force[type] ?? 0), 0);

/** A typical player force of `size`: melee (two swordsmen per axeman), optionally archers and cavalry. */
export const typicalForce = (
  size: number, support: { archers?: boolean; cavalry?: boolean } = {}, ranks: readonly number[] = [0]
): ForceSpec => {
  const archer = support.archers ? Math.round(size * ARCHER_SHARE) : 0;
  const cavalry = support.cavalry ? Math.round(size * CAVALRY_SHARE) : 0;
  const heavy = Math.round((size - archer - cavalry) * AXEMAN_SHARE);
  return { archer, cavalry, heavy, ranks, shield: size - archer - cavalry - heavy };
};

const advance = (simulation: SettlementSimulation, seconds: number) => {
  for (let second = 0; second < seconds; second++) simulation.update(1);
};

const factionOf = (soldier: { combat?: { faction: number } }) => soldier.combat?.faction ?? 0;
const playerSoldiers = (simulation: SettlementSimulation) =>
  simulation.militarySoldiers().filter(soldier => factionOf(soldier) === 0);
const hostileSoldiers = (simulation: SettlementSimulation) =>
  simulation.militarySoldiers().filter(soldier => factionOf(soldier) > 0);
/** Walls of a hostile fort (colony forts are destroyed, not captured). */
const wallsOf = (simulation: SettlementSimulation, uid: number) =>
  simulation.militaryDoors().find(door => door.building === uid)?.structure;
/** Hostile buildings still standing (a fallen fort only burns down). */
const hostileBuildings = (simulation: SettlementSimulation) =>
  simulation.buildings().filter(building => (building.militaryFaction ?? 0) > 0 &&
    (wallsOf(simulation, building.uid)?.hp ?? 1) > 0);
const isDefended = (simulation: SettlementSimulation, uid: number) =>
  hostileSoldiers(simulation).some(soldier => soldier.building === uid);
const phases = (simulation: SettlementSimulation) =>
  new Map(simulation.frames().map(actor => [actor.uid, actor]));

/** Calls the force out of the headquarters to `rally` and waits until it stands there in formation. */
const deploy = (simulation: SettlementSimulation, force: ForceSpec, rally: SettlementPoint) => {
  simulation.receiveTroops(forceTroops(force));
  simulation.callOutMilitary([...ALL_TYPES], rally);
  const arrived = (soldier: ReturnType<typeof playerSoldiers>[number], bodies: ReturnType<typeof phases>) => {
    const body = bodies.get(soldier.actor);
    return body?.phase === "militaryField" && body.pathIndex >= body.path.length && !soldier.combat?.destination;
  };
  for (let second = 0; second < DEPLOY_SECONDS; second++) {
    const bodies = phases(simulation);
    if (playerSoldiers(simulation).every(soldier => soldier.stationed || arrived(soldier, bodies))) return;
    simulation.update(1);
  }
};

const centreOf = (points: readonly SettlementPoint[]) => points.reduce((sum, point) =>
  ({ x: sum.x + point.x / points.length, z: sum.z + point.z / points.length }), { x: 0, z: 0 });
const distance = (a: SettlementPoint, b: SettlementPoint) => Math.hypot(a.x - b.x, a.z - b.z);

/** A point `range` tiles out in front of the door (archers: beyond the walls' dead zone, inside bow range). */
const standoffPoint = (site: SettlementBuilding, range = ARCHER_STANDOFF) => {
  const dx = site.access.x - site.x, dz = site.access.z - site.z, length = Math.hypot(dx, dz) || 1;
  return { x: site.access.x + dx / length * range, z: site.access.z + dz / length * range };
};

/** Wide compounds put lookouts on several sides; support bows approach an exposed post. */
const campStandoffPoint = (site: SettlementBuilding, army: SettlementPoint) => {
  if (site.bandit === undefined) return standoffPoint(site);
  const posts = garrisonSlots(site.typeId, "roman", true, site.bandit, true)
    .filter(slot => slot.kind === "archer").map(slot => exposedGarrisonFigure(slot, site).feet);
  if (!posts.length) return standoffPoint(site);
  const points = posts.map(post => {
    const dx = post.x - site.x, dz = post.z - site.z, length = Math.hypot(dx, dz) || 1;
    return { x: post.x + dx / length * ARCHER_STANDOFF,
      z: post.z + dz / length * ARCHER_STANDOFF };
  });
  return points.sort((a, b) => distance(a, army) - distance(b, army))[0]!;
};

/**
 * The player's assault, as a careful player plays it: field enemies are fought first (every
 * soldier attack-moves on the nearest one), then the nearest fort is besieged by the foot melee and
 * the riders (owner decision 2026-10-13: riders dismount at the door when a place is free) while
 * archers take the stand-off point in front of its door.
 */
const createAssaultController = (simulation: SettlementSimulation) => {
  const supported = new Set<number>();
  const fieldBattle = (bodies: ReturnType<typeof phases>, targets: readonly SettlementPoint[], ours: number[]) => {
    const army = centreOf(ours.map(id => bodies.get(id)!));
    const target = targets.slice().sort((a, b) => distance(a, army) - distance(b, army))[0]!;
    simulation.commandMilitary(ours, { x: target.x, z: target.z }, "attackMove");
    supported.clear();
  };
  const siege = (bodies: ReturnType<typeof phases>, ours: ReturnType<typeof playerSoldiers>) => {
    const army = centreOf(ours.map(soldier => bodies.get(soldier.actor)!));
    const fort = hostileBuildings(simulation).sort((a, b) => distance(a, army) - distance(b, army))[0]!;
    // An emptied colony fort's walls are attacked by everyone, archers included.
    const assault = wallsOf(simulation, fort.uid) !== undefined && !isDefended(simulation, fort.uid);
    const besiegers = ours.filter(soldier => assault || BESIEGERS.includes(soldier.combat!.type));
    const idle = besiegers.filter(soldier => soldier.combat?.siege !== fort.uid).map(soldier => soldier.actor);
    if (idle.length) simulation.siegeMilitary(idle, fort.uid);
    if (supported.has(fort.uid)) return;
    supported.add(fort.uid);
    const ofType = (type: MilitaryTroopType) =>
      ours.filter(soldier => soldier.combat!.type === type).map(soldier => soldier.actor);
    const archers = ofType("archer");
    if (archers.length) simulation.commandMilitary(archers, campStandoffPoint(fort, army), "attackMove");
  };
  return (second: number) => {
    const bodies = phases(simulation);
    const ours = playerSoldiers(simulation).filter(soldier => bodies.get(soldier.actor)?.phase === "militaryField");
    const field = hostileSoldiers(simulation).map(soldier => bodies.get(soldier.actor)!)
      .filter(body => body.phase === "militaryField");
    if (field.length) {
      if (second % FIELD_ORDER_SECONDS === 0 && ours.length) fieldBattle(bodies, field, ours.map(soldier => soldier.actor));
      return;
    }
    if (hostileBuildings(simulation).length && ours.length) siege(bodies, ours);
  };
};

const hostileFieldCount = (simulation: SettlementSimulation) => {
  const bodies = phases(simulation);
  return hostileSoldiers(simulation).filter(soldier => bodies.get(soldier.actor)?.phase === "militaryField").length;
};

const canStillWin = (simulation: SettlementSimulation) => {
  const ours = playerSoldiers(simulation);
  if (!ours.length) return false;
  // Archers cannot take a door and riders never capture; a guard left in a captured fort stays there.
  // Every soldier can strike a colony fort's walls.
  const walls = hostileBuildings(simulation).some(site => wallsOf(simulation, site.uid));
  return !hostileBuildings(simulation).length ||
    ours.some(soldier => !soldier.stationed && (walls || FOOT_MELEE.includes(soldier.combat!.type)));
};

const traceAssault = (simulation: SettlementSimulation, second: number) => {
  const bodies = phases(simulation);
  const describe = (soldier: ReturnType<typeof playerSoldiers>[number]) => {
    const body = bodies.get(soldier.actor)!;
    return `${soldier.combat!.type[0]}${soldier.rank}@${body.x.toFixed(0)},${body.z.toFixed(0)}` +
      `:${body.phase.replace("military", "")}${soldier.combat?.siege === undefined ? "" : "S"}`;
  };
  console.log(second, "forts", hostileBuildings(simulation).map(site => `${site.typeId}@${site.x},${site.z}`).join(" "),
    "\n ours", playerSoldiers(simulation).map(describe).join(" "),
    "\n them", hostileSoldiers(simulation).map(describe).join(" "));
};

/** Runs the assault until every hostile soldier and building is gone, the force is spent or time is up. */
const runAssault = (simulation: SettlementSimulation, force: number, limit: number): AssaultOutcome => {
  const order = createAssaultController(simulation);
  const losses = () => force - playerSoldiers(simulation).length;
  let second = 0, fieldLosses: number | undefined;
  const outcome = (won: boolean) => ({ fieldLosses: fieldLosses ?? losses(), force, losses: losses(), seconds: second, won });
  for (; second < limit; second++) {
    if (!hostileSoldiers(simulation).length && !hostileBuildings(simulation).length) return outcome(true);
    if (!canStillWin(simulation)) break;
    if (fieldLosses === undefined && !hostileFieldCount(simulation)) fieldLosses = losses();
    order(second);
    if (process.env.BALANCE_TRACE && second % 100 === 0) traceAssault(simulation, second);
    simulation.update(1);
  }
  return outcome(false);
};

/** Defenders of one fully manned garrison of `typeId`, as the hostile fort plans man it. */
export const garrisonPlan = (typeId: number, ranks: readonly number[]) =>
  fortPlans([typeId], GARRISON_CAPACITIES[typeId]!, ranks)[0]!;

/** A force of `force` attacks one fully manned hostile garrison of `typeId`. */
export const simulateGarrisonAssault = (
  options: { typeId: number; force: ForceSpec; seed: number; ranks?: readonly number[]; limit?: number }
): AssaultOutcome => {
  const simulation = createBalanceSimulation(GARRISON_MAP_SIZE, options.seed);
  const site = placeHostileSite(simulation, options.typeId, 40, 40);
  const plan = garrisonPlan(options.typeId, options.ranks ?? [0]);
  const ids = plan.troops.map((type, index) => spawnAround(simulation, site.access, type, plan.ranks[index]));
  if (!simulation.registerMilitaryGarrison(site.uid, ids, 1, plan.doorHp)) throw new Error("Garrison refused");
  deploy(simulation, options.force, { x: 22, z: 22 });
  return runAssault(simulation, forceSize(options.force), options.limit ?? 1800);
};

/**
 * Seconds a force needs to bring down the walls of an undefended colony fort of `typeId`
 * (owner decision 2026-10-13: 10,000 / 20,000 / 35,000 / 50,000 HP by size).
 */
export const simulateWallAssault = (
  options: { typeId: number; force: ForceSpec; seed: number; limit?: number }
) => {
  const simulation = createBalanceSimulation(GARRISON_MAP_SIZE, options.seed);
  const site = placeHostileSite(simulation, options.typeId, 40, 40);
  if (!simulation.registerMilitaryGarrison(site.uid, [], 1, 150, buildingStructure(options.typeId)))
    throw new Error("Walls refused");
  deploy(simulation, options.force, { x: 30, z: 30 });
  simulation.siegeMilitary(playerSoldiers(simulation).map(soldier => soldier.actor), site.uid);
  // Real-time steps: blows land on the swing's timing, which whole-second steps would coarsen.
  const limit = (options.limit ?? 900) * WALL_STEPS_PER_SECOND;
  for (let step = 0; step < limit; step++) {
    if (wallsOf(simulation, site.uid)!.hp <= 0) return Math.round(step / WALL_STEPS_PER_SECOND);
    simulation.update(1 / WALL_STEPS_PER_SECOND);
  }
  return null;
};

const colonyIsland = (difficulty: ColonyDifficulty, seed: number): ColonyIsland =>
  ({ difficulty, id: 0, name: "Balance", ore: "stone", seed, voyageSeconds: 120 });

/** A whole colony island (its forts of `difficulty`, fully manned) on a flat island of the expedition size. */
export const simulateColonyAssault = (
  options: { difficulty: ColonyDifficulty; force: ForceSpec; seed: number; limit?: number }
): AssaultOutcome => {
  const simulation = createBalanceSimulation(EXPEDITION_ISLAND_SIZE, options.seed);
  const started = simulation.startColony({ island: colonyIsland(options.difficulty, options.seed), landed: {},
    troops: [] });
  if (!started.ok) throw new Error(started.reason);
  const enemies = hostileSoldiers(simulation).length;
  deploy(simulation, options.force, { x: 16, z: 16 });
  return { ...runAssault(simulation, forceSize(options.force), options.limit ?? 3600), enemies };
};

export const summarize = (outcomes: readonly AssaultOutcome[]): BalanceSummary => {
  const wins = outcomes.filter(outcome => outcome.won);
  const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
  return {
    lossShare: mean(outcomes.map(outcome => outcome.losses / outcome.force)),
    meanFieldLosses: mean(outcomes.map(outcome => outcome.fieldLosses)),
    meanLosses: mean(outcomes.map(outcome => outcome.losses)),
    meanWinSeconds: wins.length ? mean(wins.map(outcome => outcome.seconds)) : null,
    runs: outcomes.length,
    winRate: wins.length / (outcomes.length || 1)
  };
};

/** Runs one case over every seed. */
export const runSeeds = <T>(run: (seed: number) => T, seeds: readonly number[] = BALANCE_SEEDS) => seeds.map(run);

export { advance as advanceSeconds, deploy as deployForce };
