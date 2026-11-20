import { expect, it } from "vitest";

import { COMMANDER_INPUT_BUTTON } from "../../island-of-settlers-shared/src/commander-input";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { WorkerNation } from "../src/render-common/workers/worker-unit";
import { fightingType } from "../src/shared/settlement/military-combat-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { commanderDefinition, commanderRecruitCost } from "../src/shared/settlement/settlement-commander";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

const recruited = (nation: WorkerNation) => {
  const world = huntingWorld(), roads = createRoadNetwork(world);
  const cost = commanderRecruitCost(nation);
  const simulation = createSettlementSimulation({ clockStart: 0, developmentAllowed: true, initialSettlers: 20,
    initialStock: { ...Object.fromEntries(Object.keys(cost).map(ware => [ware, 40])), cloth: 40, planks: 40, stone: 40 },
    playerLevel: () => 23, playerNation: nation, roads, world });
  const [w, d] = getBuildingDefinition(62).gridFootprint;
  const placed = simulation.placeBuilding(62, 26 + w / 2, 22 + d / 2);
  if (!placed.ok || !placed.building) throw new Error(placed.reason);
  Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
  roads.addRoad(simulation.headquarters.access, placed.building.access);
  expect(simulation.recruitCommander(placed.building.uid).ok).toBe(true);
  const state = () => simulation.militarySoldiers().find(soldier => soldier.commanderId)!;
  return { simulation, state };
};

it.each<WorkerNation>(["roman", "japanese", "viking", "nubian", "chinese", "maya", "persian", "indigenous"])(
  "binds the actual %s commander catalogue weapon while retaining its physical horse identity", nation => {
    const f = recruited(nation), loadout = commanderDefinition(nation).loadout, before = f.state();
    expect(before.combat).toMatchObject({ commanderLoadout: loadout, type: "cavalry" });
    expect(f.simulation.frames().find(actor => actor.uid === before.actor)!.tool).toBe(loadout);
    expect(f.simulation.loadState(f.simulation.saveState())).toEqual({ ok: true });
    expect(f.state().combat!.mount).toBe(before.combat!.mount);
    expect(f.state().combat!.hp).toBe(before.combat!.hp);
    expect(fightingType(f.state().combat!)).toBe(({ axe: "heavy", bow: "archer", sword: "cavalry" } as const)[loadout]);
  }
);

it("rejects a forged weapon and derives the catalogue weapon for an older commander snapshot", () => {
  const f = recruited("nubian"), forged = f.simulation.saveState();
  forged.military!.soldiers.find(row => row.commanderId)!.combat!.commanderLoadout = "axe";
  expect(f.simulation.loadState(forged)).toMatchObject({ ok: false, reason: "Invalid commander loadout" });
  const legacy = f.simulation.saveState(), soldier = legacy.military!.soldiers.find(row => row.commanderId)!;
  delete soldier.combat!.commanderLoadout;
  legacy.actors.find(actor => actor.uid === soldier.actor)!.tool = "sword";
  expect(f.simulation.loadState(legacy)).toEqual({ ok: true });
  expect(f.state().combat!.commanderLoadout).toBe("bow");
  expect(f.simulation.frames().find(actor => actor.uid === soldier.actor)!.tool).toBe("bow");
});

it.each([true, false])("actually releases ordinary AI bow projectiles while mounted=%s", mounted => {
  const f = recruited("nubian"), saved = f.simulation.saveState();
  const soldier = saved.military!.soldiers.find(row => row.commanderId)!;
  const actor = saved.actors.find(row => row.uid === soldier.actor)!;
  Object.assign(actor, { phase: "militaryField", visible: true, mounted: true, x: 40, z: 40, yaw: 0 });
  soldier.building = -3;
  saved.military!.commander!.location = "field";
  expect(f.simulation.loadState(saved)).toEqual({ ok: true });
  if (!mounted) {
    const control = f.simulation.beginCommanderControl(actor.uid);
    if (!control.ok) throw new Error(control.reason);
    f.simulation.update(.05);
    expect(f.simulation.submitCommanderInput({ generation: control.generation, forward: 0, right: 0,
      heading: 0, pitch: 0, buttons: COMMANDER_INPUT_BUTTON.dismount })).toBe(true);
    f.simulation.update(.05); f.simulation.endCommanderControl(control.generation);
    expect(f.simulation.frames().find(body => body.uid === actor.uid)!.mounted).toBe(false);
  }
  expect(f.simulation.spawnMilitaryOpponent({ x: 40, z: 44 }, "shield")).not.toBeNull();
  let released = false;
  for (let tick = 0; tick < 100; tick++) {
    f.simulation.update(.05);
    if (f.simulation.militaryArrows().some(arrow => arrow.shooter === actor.uid)) { released = true; break; }
  }
  expect(released, JSON.stringify({ soldier: f.state(), actor: f.simulation.frames().find(a => a.uid === actor.uid) })).toBe(true);
  expect(f.state().combat!.type).toBe("cavalry");
  expect(f.state().combat!.mount).toBe(soldier.combat!.mount);
});

it("deals ordinary enemy damage with the actual controlled mounted Viking axe", () => {
  const f = recruited("viking"), saved = f.simulation.saveState();
  const soldier = saved.military!.soldiers.find(row => row.commanderId)!;
  const actor = saved.actors.find(row => row.uid === soldier.actor)!;
  Object.assign(actor, { phase: "militaryField", visible: true, mounted: true, x: 40, z: 40, yaw: 0 });
  soldier.building = -3; saved.military!.commander!.location = "field";
  expect(f.simulation.loadState(saved)).toEqual({ ok: true });
  const enemy = f.simulation.spawnMilitaryOpponent({ x: 40, z: 40.9 }, "shield");
  expect(enemy).not.toBeNull();
  const hp = () => f.simulation.militarySoldiers().find(row => row.actor === enemy)?.combat?.hp ?? 0;
  const before = hp(), control = f.simulation.beginCommanderControl(actor.uid);
  if (!control.ok) throw new Error(control.reason);
  for (let tick = 0; tick < 60 && hp() === before; tick++) {
    f.simulation.update(.05);
    expect(f.simulation.submitCommanderInput({ generation: control.generation, forward: 0, right: 0,
      heading: 0, pitch: 0, buttons: COMMANDER_INPUT_BUTTON.attack })).toBe(true);
  }
  expect(hp()).toBeLessThan(before);
  expect(f.state().combat).toMatchObject({ commanderLoadout: "axe", mount: soldier.combat!.mount, type: "cavalry" });
  expect(f.simulation.loadState(f.simulation.saveState())).toEqual({ ok: true });
});
