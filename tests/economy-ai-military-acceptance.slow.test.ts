import { describe, expect, it } from "vitest";

import { createGameSave } from "../src/shared/settlement/game-save";
import { ownerOf } from "../src/shared/settlement/settlement-ownership";
import { canonicalJson, hashText } from "../src/shared/settlement/settlement-state-hash";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import type { WorldData } from "../src/shared/world/world-data";
import { exportEconomySaveFixture } from "./helpers/economy-save-fixtures";
import {
  createMilitaryIsland, createMilitarySimulation, MILITARY_AI, type MilitarySimulation
} from "./helpers/military-island";

/**
 * Enemy economy AI P4 acceptance (plan §7 P4, lane EAI4a): on the military island (`military-island.ts`) the
 * `develop` faction, from a stocked depot with a two-soldier reserve, builds its weapons chain (charcoal, iron mine,
 * smelter, armory), its armour and beer chains and its Military Academy, trains soldiers from wares it produced,
 * mans its towers and expands its territory with garrisoned guardhouses.
 */
const TICKS_PER_SECOND = 20;
const TICKS_PER_MINUTE = 60 * TICKS_PER_SECOND;
const ACCEPT_MINUTES = 180;
const TEST_TIMEOUT = 3_600_000;
const GUARDHOUSE = 2;
/** Armory, iron smelter, charburner and iron mine. */
const WEAPONS_CHAIN = [24, 26, 27, 12] as const;
const ACADEMY = 40;
const START_SOLDIERS = 2;

const ownBuildings = (simulation: MilitarySimulation) =>
  simulation.buildings().filter(building => ownerOf(building) === MILITARY_AI);

const finishedOf = (buildings: readonly SettlementBuilding[], typeId: number) =>
  buildings.filter(building => building.typeId === typeId && building.construction >= 1).length;

const factionSoldiers = (simulation: MilitarySimulation) =>
  simulation.saveState().military?.soldiers.filter(soldier => soldier.combat?.faction === MILITARY_AI) ?? [];

/** The faction's stationed guardhouse soldiers, and the guardhouses holding one (each claims its land). */
const guardhouseGarrison = (simulation: MilitarySimulation, buildings: readonly SettlementBuilding[]) => {
  const towers = new Set(buildings.filter(building => building.typeId === GUARDHOUSE && building.construction >= 1)
    .map(building => building.uid));
  const stationed = factionSoldiers(simulation).filter(soldier => towers.has(soldier.building) && soldier.stationed);
  return { held: new Set(stationed.map(soldier => soldier.building)).size, soldiers: stationed.length };
};

interface Milestones {
  academy?: number;
  expanded?: number;
  manned?: number;
  recruited?: number;
  weapons?: number;
}

const minute = (simulation: MilitarySimulation) =>
  Math.round(simulation.gameTick() / TICKS_PER_MINUTE * 10) / 10;

/**
 * Records the first minute of each milestone: recruits count beyond the start reserve; `manned` needs more
 * guardhouse soldiers than the start reserve had (produced soldiers man the towers); `expanded` two held guardhouses.
 */
const recordMilestones = (simulation: MilitarySimulation, reached: Milestones) => {
  const buildings = ownBuildings(simulation), now = minute(simulation);
  if (WEAPONS_CHAIN.every(typeId => finishedOf(buildings, typeId) > 0)) reached.weapons ??= now;
  if (finishedOf(buildings, ACADEMY) > 0) reached.academy ??= now;
  if (factionSoldiers(simulation).length > START_SOLDIERS) reached.recruited ??= now;
  const garrison = guardhouseGarrison(simulation, buildings);
  if (garrison.soldiers > START_SOLDIERS) reached.manned ??= now;
  if (garrison.held >= 2) reached.expanded ??= now;
};

const done = (reached: Milestones) =>
  [reached.weapons, reached.academy, reached.recruited, reached.manned, reached.expanded]
    .every(value => value !== undefined);

/** Plays minute by minute until every milestone is reached; the milestones and the island's progress log. */
const playUntilArmy = (simulation: MilitarySimulation) => {
  const reached: Milestones = {};
  while (simulation.gameTick() < ACCEPT_MINUTES * TICKS_PER_MINUTE && !done(reached)) {
    const next = simulation.gameTick() + TICKS_PER_MINUTE;
    while (simulation.gameTick() < next) simulation.update(.05);
    recordMilestones(simulation, reached);
    if (minute(simulation) % 10 === 0) {
      const buildings = ownBuildings(simulation);
      process.stderr.write(`P4 ${minute(simulation)} min: ${buildings.length} buildings ` +
        `(${buildings.filter(building => building.construction < 1).length} sites), ` +
        `${factionSoldiers(simulation).length} soldiers, ${JSON.stringify(reached)}\n`);
    }
  }
  return reached;
};

const exportReviewSave = async (simulation: MilitarySimulation, world: WorldData) => {
  if (!process.env.ECONOMY_SAVE_FIXTURE_OUTPUT) return;
  const { rotation, x, z } = simulation.headquarters;
  const scenario = { ...world.scenario!, headquarters: { rotation, x, z } };
  await exportEconomySaveFixture("p4-military", await createGameSave({ ...world, scenario }, simulation.saveState(),
    { animals: [], name: "P4 military district", savedAt: 0, source: "generated" }));
};

describe("develop AI military production on the military island (P4 acceptance)", () => {
  it(`builds its weapons chain, trains and garrisons soldiers and expands within ${ACCEPT_MINUTES} minutes`,
    async () => {
      const { simulation, world } = createMilitaryIsland();
      const reached = playUntilArmy(simulation);
      await exportReviewSave(simulation, world);
      process.stderr.write(`P4 military island: ${JSON.stringify(reached)}\n`);
      expect(done(reached), JSON.stringify(reached)).toBe(true);
    }, TEST_TIMEOUT);
});

const DETERMINISM_TICKS = 40 * TICKS_PER_MINUTE;
const RELOAD_TICK = 25 * TICKS_PER_MINUTE + 13;
const stateHash = (simulation: MilitarySimulation) =>
  hashText(canonicalJson({ ...simulation.saveState(), accumulator: 0 }));
const run = (simulation: MilitarySimulation, frames: readonly number[], ticks: number) => {
  for (let frame = 0; simulation.gameTick() < ticks; frame++)
    simulation.update(Math.min(frames[frame % frames.length]!, (ticks - simulation.gameTick()) * .05));
};

describe("develop AI military determinism on the military island (P4 gate)", () => {
  it("reaches the same full state hash at any frame rate and after a save and reload", () => {
    const reference = createMilitaryIsland().simulation;
    run(reference, [.05], DETERMINISM_TICKS);
    const expected = stateHash(reference);
    const mixed = createMilitaryIsland().simulation;
    run(mixed, [.016, .05, .033, .1], DETERMINISM_TICKS);
    expect(stateHash(mixed)).toBe(expected);
    const { simulation: first, world } = createMilitaryIsland();
    run(first, [.05], RELOAD_TICK);
    const reloaded = createMilitarySimulation(structuredClone(world));
    expect(reloaded.loadState(JSON.parse(JSON.stringify(first.saveState())))).toEqual({ ok: true });
    run(reloaded, [1 / 60], DETERMINISM_TICKS);
    expect(stateHash(reloaded)).toBe(expected);
  }, TEST_TIMEOUT);
});
