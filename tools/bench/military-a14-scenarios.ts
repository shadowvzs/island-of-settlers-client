import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { COMMANDER_LODGE_TYPE_ID } from "../../src/shared/settlement/building-type-ids";
import type { MilitaryDirectorPort } from "../../src/shared/settlement/commander/director-types";
import type { IntentReceipt } from "../../src/shared/settlement/commander/strategic-intents";
import type { MilitaryTroopType } from "../../src/shared/settlement/military-combat-rules";
import type { SettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementPoint } from "../../src/shared/settlement/settlement-types";
import type { WorldData } from "../../src/shared/world/world-data";
import {
  createBalanceSettlement, createBalanceSimulation, deployForce, type ForceSpec, placeFinished, placeHostileSite,
  spawnAround
} from "./garrison-balance-harness";
import {
  fieldBattleScenario, type MotionScenario, openBlocked, spawnAt, spawnRows
} from "./military-motion-scenarios";

/**
 * A14 Commander 2.0 battle fixtures (docs/plans/a14-commander-2-plan-2026-11-13.md §10.1): deterministic,
 * headless set pieces measured by `military-a14-metrics.ts`. The player is faction 0 (its soldiers are
 * called out of the headquarters and take no commander orders); computer factions are 1 and up. Fixtures
 * whose feature does not exist yet carry a named TODO hook (`pendingHooks`) that a later lane fills.
 */
export interface A14Scenario extends MotionScenario {
  key: A14FixtureKey;
  /** Computer factions whose commander decisions are traced. */
  computerFactions: readonly number[];
  /** Tiles of the ridge a commander should use as overwatch: [minX, minZ, maxX, maxZ]. */
  overwatchArea?: readonly [number, number, number, number];
  /** Features this fixture needs that master lacks: `<lane>:<hook>` names. */
  pendingHooks: readonly string[];
}

export type A14FixtureKey = "field16" | "field32" | "field64" | "archersVsCharge" | "flank" | "flankControl" |
  "hillOverwatch" |
  "outnumberedRout" | "auraRally" | "unseenArcher" | "fogRaid" | "intentContract" | "defendPost" | "siteRaid" |
  "stagger4";

const MAP = 96;
const HQ_WEST = { x: 10.5, z: 48.5 };
const PLAYER_LINE = { x: 32, z: 48 };
/** The computer camp of the intent fixtures. */
const CAMP = { x: 64, z: 48 };
const FOOT_SPACING = .9;
const COMPUTER = 1;
const BATTLE_VIEW = [20, 30, 76, 66] as const;
/** The field fixtures' island seed (`fieldBattleScenario`'s default). */
const FIELD_SEED = 7;

/** A row block of one computer faction facing west (`facing` -1) or east (+1). */
const computerBlock = (
  simulation: SettlementSimulation, centre: SettlementPoint, types: readonly MilitaryTroopType[],
  perRow = 8, faction = COMPUTER, facing = -1
) => spawnRows(simulation, centre, facing, types, perRow, FOOT_SPACING, faction);

const repeat = (type: MilitaryTroopType, count: number): MilitaryTroopType[] => Array(count).fill(type);

const playerSoldiers = (simulation: SettlementSimulation, types?: readonly MilitaryTroopType[]) =>
  simulation.militarySoldiers().filter(soldier => (soldier.combat?.faction ?? 0) === 0 && soldier.combat &&
    (!types || types.includes(soldier.combat.type)) && soldier.commanderId === undefined)
    .map(soldier => soldier.actor);

/** Calls player groups out of the headquarters one after the other (back rows first). */
const deployPlayer = (simulation: SettlementSimulation, groups: readonly [ForceSpec, SettlementPoint][]) => {
  for (const [force, rally] of groups) deployForce(simulation, force, rally);
};

const playerSimulation = (seed: number, shape?: (world: WorldData) => void) =>
  createBalanceSimulation(MAP, seed, HQ_WEST, shape);

/** A simulation whose strategic director port is handed to the fixture (A14-4a: permits and waves). */
const directedSimulation = (seed: number, start: SettlementPoint) => {
  let port: MilitaryDirectorPort | undefined;
  const simulation = createBalanceSimulation(MAP, seed, start, undefined, { onMilitaryDirector: given => {
    port = given;
  } });
  const director = () => {
    if (!port) throw new Error("No military director");
    return port;
  };
  return { director, simulation };
};

const battle = (
  key: A14FixtureKey, simulation: SettlementSimulation, seconds: number, start: () => void,
  extra: Partial<Pick<A14Scenario, "computerFactions" | "overwatchArea" | "pendingHooks" | "view">> = {}
): A14Scenario => ({
  blocked: openBlocked, computerFactions: [COMPUTER], key, marching: false, name: key, pendingHooks: [],
  seconds, simulation, start, view: BATTLE_VIEW, ...extra
});

/** Existing field NvN (two computer factions, mixed types), kept as the no-regression fixture. */
const fieldFixture = (size: 16 | 32 | 64, seedOffset = 0): A14Scenario => {
  const seconds = { 16: 45, 32: 60, 64: 75 }[size];
  return { ...fieldBattleScenario(size, seconds, false, FIELD_SEED + seedOffset), computerFactions: [1, 2],
    key: `field${size}`,
    pendingHooks: [] };
};

/**
 * 8 computer archers behind 8 shields against a player charge: 6 axemen in front, 4 swordsmen behind them
 * (ordinary cavalry is retired, HORSE-RETIREMENT-01, so the charge is on foot). The danger matrix should make
 * the archers open on the axemen.
 */
export const archersVsChargeFixture = (seconds = 60, seedOffset = 0) => {
  const simulation = playerSimulation(21 + seedOffset);
  deployPlayer(simulation, [
    [{ ranks: [0], shield: 4 }, { x: PLAYER_LINE.x - 2, z: PLAYER_LINE.z }],
    [{ heavy: 6, ranks: [0] }, PLAYER_LINE]
  ]);
  computerBlock(simulation, { x: 60, z: 48 }, repeat("shield", 8));
  computerBlock(simulation, { x: 63, z: 48 }, repeat("archer", 8));
  return battle("archersVsCharge", simulation, seconds, () => {
    simulation.commandMilitary(playerSoldiers(simulation), { x: 62, z: 48 }, "attackMove");
  });
};

/**
 * Computer 18 axemen + 6 swordsmen in two wings (the fast foot flank, riders being retired) against a player
 * line of 12 foot with 8 archers behind it. `control`: the wings are axemen (no flank group), the gate's baseline.
 */
export const flankFixture = (seconds = 75, seedOffset = 0, control = false) => {
  const simulation = playerSimulation(23 + seedOffset);
  deployPlayer(simulation, [
    [{ archer: 8, ranks: [0] }, { x: 27, z: 48 }],
    [{ heavy: 4, ranks: [0], shield: 8 }, PLAYER_LINE]
  ]);
  // 18 axemen in three rows pin the whole 12-man player line before the wings' flank launches (main session).
  const infantry = computerBlock(simulation, { x: 62, z: 48 }, repeat("heavy", 18), 6);
  // The control's wings are axemen: one troop type, so the squad has no flank group (A14-2 flank gate).
  const wings = [-6, 6].flatMap(side =>
    computerBlock(simulation, { x: 63, z: 48 + side }, repeat(control ? "heavy" : "shield", 3), 3));
  return battle(control ? "flankControl" : "flank", simulation, seconds, () => {
    simulation.commandMilitaryOpponent([...infantry, ...wings], PLAYER_LINE, COMPUTER, "attackMove");
  });
};

/**
 * The ridge's near corner lies within bow band (7.5 tiles) of the player line, where the overwatch candidates
 * fall; A14-1 moved it from x 40-56, z 56-62, which no archer could shoot from (baseline re-recorded).
 */
const RIDGE = { maxX: 50, maxZ: 58, minX: 34, minZ: 52, height: 2, ramp: 2 } as const;
/** Height of the ridge beside the approach at vertex (x, z): a 2-tile plateau with 2-tile ramps. */
const ridgeHeight = (x: number, z: number) => {
  const outside = Math.max(RIDGE.minX - x, x - RIDGE.maxX, RIDGE.minZ - z, z - RIDGE.maxZ, 0);
  return Math.max(0, RIDGE.height * (1 - outside / RIDGE.ramp));
};
const raiseRidge = (world: WorldData) => {
  const columns = world.cellsX + 1;
  for (let z = 0; z <= world.cellsZ; z++) for (let x = 0; x < columns; x++)
    world.heights[z * columns + x] = ridgeHeight(x, z);
};

/** A mixed computer force advances along z 48 past a ridge 2 tiles high (z 52-58) on a player line. */
export const hillOverwatchFixture = (seconds = 60, seedOffset = 0) => {
  const simulation = playerSimulation(25 + seedOffset, raiseRidge);
  deployPlayer(simulation, [[{ heavy: 4, ranks: [0], shield: 8 }, PLAYER_LINE]]);
  const computer = computerBlock(simulation, { x: 64, z: 48 },
    [...repeat("shield", 6), ...repeat("heavy", 2), ...repeat("archer", 4)], 6);
  return battle("hillOverwatch", simulation, seconds, () => {
    simulation.commandMilitaryOpponent(computer, PLAYER_LINE, COMPUTER, "attackMove");
  }, { overwatchArea: [RIDGE.minX, RIDGE.minZ, RIDGE.maxX, RIDGE.maxZ] });
};

/** 6 computer soldiers caught by 24 player soldiers. */
export const outnumberedRoutFixture = (seconds = 60, seedOffset = 0) => {
  const simulation = playerSimulation(27 + seedOffset);
  deployPlayer(simulation, [
    [{ archer: 6, ranks: [0] }, { x: 28, z: 48 }],
    [{ heavy: 6, ranks: [0], shield: 12 }, PLAYER_LINE]
  ]);
  computerBlock(simulation, { x: 54, z: 48 }, [...repeat("shield", 4), ...repeat("archer", 2)], 4);
  return battle("outnumberedRout", simulation, seconds, () => {
    simulation.commandMilitary(playerSoldiers(simulation), { x: 56, z: 48 }, "attackMove");
  });
};

const LODGE_AT = { x: 18, z: 40 };
/**
 * Recruits the player's commander hero at a lodge beside the headquarters and puts it into the field at `at`
 * (the save-patch deployment of tests/settlement-commander-combat.test.ts). Returns its uid.
 */
const fieldHero = (
  simulation: SettlementSimulation, roads: ReturnType<typeof createBalanceSettlement>["roads"], at: SettlementPoint
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
  Object.assign(actor, { building: placed.building.uid, mounted: false, path: [], pathIndex: 0,
    phase: "militaryField", visible: true, x: at.x, z: at.z });
  saved.military!.commander = { ...saved.military!.commander!, location: "field" };
  const loaded = simulation.loadState(saved);
  if (!loaded.ok) throw new Error("Hero deployment refused");
  return soldier.actor;
};

const HERO_STOCK = { beer: 40, coins: 40, planks: 80, shield: 6, stone: 80, sword: 6, wine: 40 };

/** The player's commander hero with 10 soldiers against an equal computer force (11). */
export const auraRallyFixture = (seconds = 60, seedOffset = 0) => {
  const { roads, simulation } = createBalanceSettlement(MAP, 29 + seedOffset, HQ_WEST, undefined,
    { developmentAllowed: true, initialSettlers: 2, initialStock: HERO_STOCK, playerLevel: () => 23 });
  deployPlayer(simulation, [[{ heavy: 3, ranks: [0], shield: 7 }, PLAYER_LINE]]);
  fieldHero(simulation, roads, { x: PLAYER_LINE.x - 2, z: PLAYER_LINE.z });
  const computer = computerBlock(simulation, { x: 58, z: 48 }, [...repeat("shield", 7), ...repeat("heavy", 4)], 6);
  return battle("auraRally", simulation, seconds, () => {
    simulation.commandMilitaryOpponent(computer, PLAYER_LINE, COMPUTER, "attackMove");
  });
};

/**
 * Player archers shoot computer infantry from their full bow range (8 tiles). Sight (11-13) exceeds bow range on
 * flat ground, so on master the archers are seen as well as alerted; the probe gate (0 unseen reads) applies.
 */
export const unseenArcherFixture = (seconds = 45, seedOffset = 0) => {
  const simulation = playerSimulation(31 + seedOffset);
  deployPlayer(simulation, [[{ archer: 6, ranks: [0] }, { x: 40, z: 48 }]]);
  computerBlock(simulation, { x: 49, z: 48 }, repeat("shield", 8), 4);
  return battle("unseenArcher", simulation, seconds, () => {
    simulation.commandMilitary(playerSoldiers(simulation), { x: 41, z: 48 }, "attackMove");
  });
};

/** The player's Guardhouse beside the town: unseen at the start, on the scout's way to the known HQ. */
const GUARDHOUSE = { typeId: 2, x: 24, z: 44 };

/**
 * A manned computer fort far from the player's town (unseen); its field party is handed to the strategic director
 * as a permit (A14-4a): with no player site known it must scout first (towards the HQ, known from the start, Q3)
 * and strike only once the scout has seen a site.
 */
export const fogRaidFixture = (seconds = 90, seedOffset = 0) => {
  const { director, simulation } = directedSimulation(33 + seedOffset, HQ_WEST);
  placeFinished(simulation, GUARDHOUSE.typeId, GUARDHOUSE.x, GUARDHOUSE.z);
  const site = placeHostileSite(simulation, 4, 70, 48);
  const guards = (["shield", "heavy", "archer", "shield"] as const)
    .map(type => spawnAround(simulation, site.access, type));
  if (!simulation.registerMilitaryGarrison(site.uid, guards, COMPUTER)) throw new Error("Garrison refused");
  const party = computerBlock(simulation, { x: 64, z: 48 }, [...repeat("shield", 6), ...repeat("archer", 2)], 4);
  const scenario = battle("fogRaid", simulation, seconds, () => {
    if (!director().launch(COMPUTER, party, { home: site.access, kind: "permit" })) throw new Error("Permit refused");
  }, { view: [0, 24, 80, 72] });
  return { ...scenario, director };
};

/** Strength points an attack intent of the fixture asks for: eight full-health rank-0 swordsmen. */
export const INTENT_CONTRACT_STRENGTH = 800;

/**
 * The P4 intent contract (§5.4, A14-4c): a computer camp is told to attack the player's Guardhouse, which it has
 * never seen. The intent is rejected (`rejectedUnknownTarget`) and scouted; the strike starts once the scout
 * has seen the Guardhouse. `receipts` holds the answer of the `setIntents` call once the battle started.
 */
export const intentContractFixture = (seconds = 90, seedOffset = 0) => {
  const { director, simulation } = directedSimulation(35 + seedOffset, HQ_WEST);
  const guardhouse = placeFinished(simulation, GUARDHOUSE.typeId, GUARDHOUSE.x, GUARDHOUSE.z);
  computerBlock(simulation, CAMP, [...repeat("shield", 8), ...repeat("archer", 4)], 4);
  const receipts: IntentReceipt[] = [];
  const scenario = battle("intentContract", simulation, seconds, () => {
    receipts.push(...director().strategy.setIntents(COMPUTER, [{ kind: "attack",
      minStrength: INTENT_CONTRACT_STRENGTH, target: { kind: "site", uid: guardhouse.uid } }]));
  }, { view: [0, 24, 80, 72] });
  return { ...scenario, director, receipts, target: guardhouse.uid };
};

/** The post the defend intent names: the area round the computer camp. */
export const DEFEND_POST = { radius: 10, x: CAMP.x, z: CAMP.z };

/**
 * A defend post reacting to a threat (A14-4c intent, fixture asked for in A14-5): a computer camp is told to
 * defend the area round itself; a player party marches on it. The post holds until an enemy it knows stands
 * inside its area, then goes for it (`hold>defend`); it never strikes or scouts.
 */
export const defendPostFixture = (seconds = 60, seedOffset = 0) => {
  const { director, simulation } = directedSimulation(39 + seedOffset, HQ_WEST);
  deployPlayer(simulation, [[{ ranks: [0], shield: 6 }, PLAYER_LINE]]);
  computerBlock(simulation, CAMP, [...repeat("shield", 8), ...repeat("archer", 4)], 4);
  const receipts: IntentReceipt[] = [];
  const scenario = battle("defendPost", simulation, seconds, () => {
    receipts.push(...director().strategy.setIntents(COMPUTER, [{ area: DEFEND_POST, kind: "defend", priority: 1 }]));
    simulation.commandMilitary(playerSoldiers(simulation), { x: CAMP.x - 4, z: CAMP.z }, "attackMove");
  });
  return { ...scenario, director, receipts };
};

/** The player's Guardhouse of the site raid: inside the camp's sight, so the faction knows it from the start. */
const RAIDED_GUARDHOUSE = { typeId: 2, x: 54, z: 44 };
/** Ticks the site raid's camp looks round before its intent is set (the vision phase fills the ledger). */
const SITE_RAID_SIGHT_TICKS = 2;

/**
 * A known-site raid through an intent (A14-4c, fixture asked for in A14-5): the camp sees the player's
 * Guardhouse before it is told to raid it, so the intent is accepted at once (no scouting): at most six soldiers
 * muster, hit the named site and withdraw when the raid is over.
 */
export const siteRaidFixture = (seconds = 120, seedOffset = 0) => {
  const { director, simulation } = directedSimulation(41 + seedOffset, HQ_WEST);
  const guardhouse = placeFinished(simulation, RAIDED_GUARDHOUSE.typeId, RAIDED_GUARDHOUSE.x, RAIDED_GUARDHOUSE.z);
  computerBlock(simulation, CAMP, [...repeat("shield", 8), ...repeat("archer", 4)], 4);
  for (let tick = 0; tick < SITE_RAID_SIGHT_TICKS; tick++) simulation.update(.05);
  const receipts: IntentReceipt[] = [];
  const scenario = battle("siteRaid", simulation, seconds, () => {
    receipts.push(...director().strategy.setIntents(COMPUTER, [{ kind: "raid",
      target: { kind: "site", uid: guardhouse.uid } }]));
  }, { view: [30, 24, 80, 72] });
  return { ...scenario, director, receipts, target: guardhouse.uid };
};

const QUADRANTS: readonly SettlementPoint[] = [
  { x: 26, z: 26 }, { x: 70, z: 26 }, { x: 26, z: 70 }, { x: 70, z: 70 }
];
const MIXED_32: readonly MilitaryTroopType[] = [...repeat("shield", 16), ...repeat("heavy", 6),
  ...repeat("archer", 7), ...repeat("shield", 3)];

/** Four computer factions of 32 soldiers each converge on the map centre as scripted waves of the director. */
export const stagger4Fixture = (seconds = 60, seedOffset = 0) => {
  const { director, simulation } = directedSimulation(37 + seedOffset, { x: 6.5, z: 6.5 });
  const centre = { x: 48, z: 48 };
  const armies = QUADRANTS.map((corner, index) =>
    MIXED_32.map((type, slot) => spawnAt(simulation,
      { x: corner.x + (slot % 8) * 1.1 - 3.85, z: corner.z + Math.floor(slot / 8) * 1.1 - 1.65 }, type, index + 1)));
  return battle("stagger4", simulation, seconds, () => {
    armies.forEach((ids, index) => {
      if (!director().launch(index + 1, ids, { goal: centre, home: QUADRANTS[index]!, kind: "wave" }))
        throw new Error("Wave refused");
    });
  }, { computerFactions: [1, 2, 3, 4], view: [12, 12, 84, 84] });
};

/**
 * Each fixture at an island seed offset (0: the recorded single run). The stuck and churn gates take the median
 * over `A14_SEED_OFFSETS` (one battle is too chaotic to compare: master's field64 ranges 8-21 stuck seconds).
 */
export const A14_FIXTURES: Readonly<Record<A14FixtureKey, (seedOffset?: number) => A14Scenario>> = {
  archersVsCharge: offset => archersVsChargeFixture(undefined, offset),
  auraRally: offset => auraRallyFixture(undefined, offset),
  defendPost: offset => defendPostFixture(undefined, offset),
  field16: offset => fieldFixture(16, offset),
  field32: offset => fieldFixture(32, offset),
  field64: offset => fieldFixture(64, offset),
  flank: offset => flankFixture(undefined, offset),
  flankControl: offset => flankFixture(undefined, offset, true),
  fogRaid: offset => fogRaidFixture(undefined, offset),
  hillOverwatch: offset => hillOverwatchFixture(undefined, offset),
  intentContract: offset => intentContractFixture(undefined, offset),
  outnumberedRout: offset => outnumberedRoutFixture(undefined, offset),
  siteRaid: offset => siteRaidFixture(undefined, offset),
  stagger4: offset => stagger4Fixture(undefined, offset),
  unseenArcher: offset => unseenArcherFixture(undefined, offset)
};

/** Island seed offsets of the median gates (offset 0 is the single recorded run). */
export const A14_SEED_OFFSETS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8];
