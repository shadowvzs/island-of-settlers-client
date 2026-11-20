import { shipDeckCapacity } from "@shared/catalog";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { TROOP_DECK_SLOTS } from "../src/shared/balance/colonies";
import { COMMANDER_LODGE_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { colonyDeckItems } from "../src/shared/settlement/colony-expedition-rules";
import { ORDINARY_TROOP_TYPES } from "../src/shared/settlement/military-combat-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { commanderMaximumHealth } from "../src/shared/settlement/settlement-commander";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { TAVERN_RECIPES } from "../src/shared/settlement/tavern-rules";
import { huntingWorld } from "./helpers/hunting-world";

/** One full sailing-ship deck (catalog `ship:sailingShip` capacity). */
const { boxes: SHIP_DECK_BOXES } = shipDeckCapacity();

const recruitedSave = () => {
  const world = huntingWorld();
  const roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({
    developmentAllowed: true, initialSettlers: 20, playerLevel: () => 23, roads, world,
    initialStock: { beer: 40, coins: 40, wine: 40, planks: 40, shield: 6, stone: 40, sword: 6 }
  });
  const [width, depth] = getBuildingDefinition(COMMANDER_LODGE_TYPE_ID).gridFootprint;
  const placed = simulation.placeBuilding(COMMANDER_LODGE_TYPE_ID, 26 + width / 2, 22 + depth / 2);
  if (!placed.ok || !placed.building) throw new Error(placed.reason);
  Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
  roads.addRoad(simulation.headquarters.access, placed.building.access);
  expect(simulation.recruitCommander(placed.building.uid).ok).toBe(true);
  return { lodge: placed.building, save: simulation.saveState(), simulation };
};

it("rejects contradictory commander XP, rank and HP values", () => {
  const { save, simulation } = recruitedSave();
  expect(simulation.loadState({ ...save, military: { ...save.military!,
    commander: { ...save.military!.commander!, level: 1, xp: 40 } } })).toMatchObject({ ok: false });
  expect(simulation.loadState({ ...save, military: { ...save.military!,
    soldiers: save.military!.soldiers.map(soldier => soldier.commanderId ? { ...soldier, rank: 1 } : soldier) } }))
    .toMatchObject({ ok: false, reason: "Invalid commander profile or rank" });
  const commander = save.military!.commander!;
  expect(simulation.loadState({ ...save, military: { ...save.military!,
    soldiers: save.military!.soldiers.map(soldier => soldier.commanderId
      ? { ...soldier, combat: { ...soldier.combat!, hp: commanderMaximumHealth(commander.level) + 1 } } : soldier) } }))
    .toMatchObject({ ok: false, reason: "Invalid military combatant" });
});

it("rejects a commander whose roster identity is detached from its soldier", () => {
  const { save, simulation } = recruitedSave();
  expect(simulation.loadState({ ...save, military: { ...save.military!, commander: undefined,
    soldiers: save.military!.soldiers.map(soldier => soldier.commanderId
      ? { ...soldier, combat: { ...soldier.combat!, hp: 100 } } : soldier) } }))
    .toMatchObject({ ok: false, reason: "Commander soldier without commander state" });
});

it("keeps a missing home as an explicit awaiting-home state instead of deleting the roster", () => {
  const { save, simulation } = recruitedSave();
  const missingHome = { ...save, military: { ...save.military!,
    commander: { ...save.military!.commander!, homeLodgeUid: 9999 } } };
  expect(simulation.loadState(missingHome)).toEqual({ ok: true });
  const commander = simulation.commanderStatus(9999)!;
  expect(commander.blockReason).toBe("missing-home");
  expect(commander.ready).toBe(false);
  expect(simulation.commanderState()).toMatchObject({ homeLodgeUid: 9999 });
  const lodgeStatus = simulation.commanderRecruitStatus(9999);
  expect(lodgeStatus.available).toBe(false);
});

it("awards one XP per qualifying result identity, once, and caps at level 3", () => {
  const { save, simulation } = recruitedSave();
  const deployed = { ...save, military: { ...save.military!,
    commander: { ...save.military!.commander!, location: "field" as const } } };
  expect(simulation.loadState(deployed)).toEqual({ ok: true });
  expect(simulation.awardCommanderExperience("adventure-7")).toBe(true);
  expect(simulation.awardCommanderExperience("adventure-7")).toBe(false);
  expect(simulation.commanderState()!.xp).toBe(1);
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  expect(simulation.commanderState()!.xp).toBe(1);
});

it("reserves the single commander player-wide across islands", () => {
  const owner: {
    claim(id: string, homeIslandSeed: number): boolean;
    current?: { id: string; homeIslandSeed: number };
    get(): { id: string; homeIslandSeed: number } | undefined;
  } = {
    claim(id, homeIslandSeed) {
      if (this.current && (this.current.id !== id || this.current.homeIslandSeed !== homeIslandSeed)) return false;
      this.current = { homeIslandSeed, id };
      return true;
    },
    get() { return this.current; }
  };
  const build = (seed: number) => {
    const world = { ...huntingWorld(), seed }, roads = createRoadNetwork(world);
    const simulation = createSettlementSimulation({
      commanderOwner: owner, developmentAllowed: true, initialSettlers: 20, playerLevel: () => 23, roads, world,
      initialStock: { beer: 40, coins: 40, wine: 40, planks: 40, shield: 6, stone: 40, sword: 6 }
    });
    const [width, depth] = getBuildingDefinition(COMMANDER_LODGE_TYPE_ID).gridFootprint;
    const placed = simulation.placeBuilding(COMMANDER_LODGE_TYPE_ID, 26 + width / 2, 22 + depth / 2);
    if (!placed.ok || !placed.building) throw new Error(placed.reason);
    Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
    roads.addRoad(simulation.headquarters.access, placed.building.access);
    return { lodge: placed.building, simulation };
  };
  const first = build(1234), second = build(1235);
  expect(first.simulation.recruitCommander(first.lodge.uid).ok).toBe(true);
  expect(second.simulation.commanderRecruitStatus(second.lodge.uid).reason)
    .toBe("Another island already has your commander");
  expect(second.simulation.recruitCommander(second.lodge.uid))
    .toEqual({ ok: false, reason: "Another island already has your commander" });
  expect(owner.current?.homeIslandSeed).toBe(1234);
});

it("keeps the commander roster and mount when its lodge is demolished", () => {
  const { lodge, simulation } = recruitedSave();
  const before = simulation.commanderState()!;
  expect(simulation.demolishBuilding(lodge.uid)).toMatchObject({ ok: true });
  expect(simulation.commanderState()).toMatchObject({ id: before.id, homeLodgeUid: lodge.uid });
  expect(simulation.militarySoldiers().filter(soldier => soldier.commanderId === before.id).length).toBe(1);
  const saved = simulation.saveState();
  expect(saved.buildings.some(building => building.uid === lodge.uid)).toBe(false);
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  expect(simulation.commanderState()!.homeLodgeUid).toBe(lodge.uid);
});

it("never classifies the commander as ordinary cavalry and reserves two deck slots", () => {
  const { save, simulation } = recruitedSave();
  const commander = simulation.commanderState()!;
  expect(ORDINARY_TROOP_TYPES).not.toContain("cavalry");
  expect(TAVERN_RECIPES).not.toHaveProperty("cavalry");
  expect(simulation.militaryStoredTroops().find(entry => entry.type === "cavalry")?.count ?? 0).toBe(0);
  expect(save.military!.soldiers.filter(soldier => soldier.commanderId === commander.id).length).toBe(1);
  expect(TROOP_DECK_SLOTS.cavalry).toBe(2);
  const items = colonyDeckItems([{ slots: TROOP_DECK_SLOTS.cavalry, uid: 7 }], {});
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ key: 7, kind: "passenger", units: TROOP_DECK_SLOTS.cavalry * SHIP_DECK_BOXES });
  expect(items[0]!.units).toBe(66);
});
