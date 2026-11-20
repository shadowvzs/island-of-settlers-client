import { describe, expect, it } from "vitest";

import { COMMANDER_INPUT_BUTTON } from "../../island-of-settlers-shared/src/commander-input";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { COMMANDER_LODGE_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { commanderRecruitCost } from "../src/shared/settlement/settlement-commander";
import { BRIDGE_SCENE_RIVERS, bridgeRiverScene } from "./helpers/bridge-river-scene";

/** The river island with a recruited commander standing in the field before the west bridge mouth. */
const commanderScene = (river: (typeof BRIDGE_SCENE_RIVERS)[number][1], kind: "stone" | "wood", mounted: boolean) => {
  const cost = commanderRecruitCost("roman");
  const scene = bridgeRiverScene(river, kind, { clockStart: 0, developmentAllowed: true, initialSettlers: 20,
    initialStock: { ...Object.fromEntries(Object.keys(cost).map(ware => [ware, 40])), cloth: 40, planks: 40, stone: 40 },
    playerLevel: () => 23, playerNation: "roman", withoutMilitaryCommander: false });
  const { simulation, west } = scene;
  const [width, depth] = getBuildingDefinition(COMMANDER_LODGE_TYPE_ID).gridFootprint;
  const placed = simulation.placeBuilding(COMMANDER_LODGE_TYPE_ID, 10 + width / 2, 14 + depth / 2);
  if (!placed.ok || !placed.building) throw new Error(placed.reason);
  Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
  scene.roads.addRoad(simulation.headquarters.access, placed.building.access);
  expect(simulation.recruitCommander(placed.building.uid).ok).toBe(true);
  // Put the commander in the field on the west bank, as after a deployment.
  const saved = simulation.saveState();
  const soldier = saved.military!.soldiers.find(row => row.commanderId)!;
  const actor = saved.actors.find(row => row.uid === soldier.actor)!;
  Object.assign(actor, { mounted: true, phase: "militaryField", visible: true, x: west.x - 6, yaw: 0, z: west.z });
  soldier.building = -3;
  saved.military!.commander!.location = "field";
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  if (!mounted) {
    const control = simulation.beginCommanderControl(actor.uid);
    if (!control.ok) throw new Error(control.reason);
    simulation.update(.05);
    expect(simulation.submitCommanderInput({ buttons: COMMANDER_INPUT_BUTTON.dismount, forward: 0,
      generation: control.generation, heading: 0, pitch: 0, right: 0 })).toBe(true);
    simulation.update(.05);
    simulation.endCommanderControl(control.generation);
  }
  const body = () => simulation.frames().find(frame => frame.uid === actor.uid)!;
  expect(body().mounted).toBe(mounted);
  return { ...scene, body, commander: actor.uid };
};

describe("the commander crosses a river bridge", () => {
  for (const kind of ["stone", "wood"] as const)
    for (const [label, river] of BRIDGE_SCENE_RIVERS)
      for (const mounted of [true, false])
        it(`rides${mounted ? "" : " (on foot)"} over the ${label} ${kind} deck with an escort that follows`, () => {
          const { body, commander, east, onDeck, placeProblem, simulation, west } = commanderScene(river, kind, mounted);
          const escort = Array.from({ length: 4 }, (_, index) => simulation.spawnDebugSoldier(
            { x: west.x - 8 - (index % 2), z: west.z - 1 + Math.floor(index / 2) * 2 },
            { rank: 0, type: (["shield", "heavy", "archer"] as const)[index % 3]! })!.id);
          expect(simulation.assignCommanderEscort(escort)).toEqual(escort);
          const goal = { x: east.x + 7, z: east.z };
          expect(simulation.commandMilitary([commander], goal, "move")).toBe(true);
          const crossed = new Set<number>(), movers = [commander, ...escort];
          let deckSamples = 0;
          for (let tick = 0; tick < 20 * 150; tick++) {
            simulation.update(.05);
            for (const frame of simulation.frames()) {
              if (!movers.includes(frame.uid) || !frame.visible) continue;
              expect(placeProblem(frame), `${frame.uid} at ${frame.x}/${frame.z}`).toBeNull();
              if (!onDeck(frame)) continue;
              crossed.add(frame.uid);
              if (frame.uid === commander) deckSamples += 1;
            }
          }
          // The commander went over the deck (the river spans the map: there is no other way).
          expect(crossed.has(commander)).toBe(true);
          expect(deckSamples).toBeGreaterThan(5);
          expect(Math.hypot(body().x - goal.x, body().z - goal.z)).toBeLessThan(2.5);
          // A rider stays in the saddle over the deck; a commander on foot may call his horse back.
          if (mounted) expect(body().mounted).toBe(true);
          // The escort follows him across and gathers on the far bank.
          for (const id of escort) {
            const soldier = simulation.frames().find(frame => frame.uid === id)!;
            expect(crossed.has(id), `escort ${id}`).toBe(true);
            expect(soldier.x).toBeGreaterThan(east.x);
          }
        });
});

describe("the commander on a removed bridge", () => {
  for (const mounted of [true, false])
    it(`is set on a bank${mounted ? " in the saddle" : " on foot"} and never stands in the river`, () => {
      const [, river] = BRIDGE_SCENE_RIVERS[1]!;
      const { body, commander, east, onDeck, placeProblem, simulation } = commanderScene(river, "wood", mounted);
      expect(simulation.commandMilitary([commander], { x: east.x + 7, z: east.z }, "move")).toBe(true);
      let ticks = 0;
      while (!onDeck(body()) && ticks++ < 20 * 150) simulation.update(.05);
      expect(onDeck(body())).toBe(true);
      expect(simulation.removeBridge(simulation.bridges()[0]!.id).ok).toBe(true);
      expect(placeProblem(body())).toBeNull();
      for (let tick = 0; tick < 20 * 40; tick++) {
        simulation.update(.05);
        expect(placeProblem(body()), `${body().x}/${body().z}`).toBeNull();
      }
    });
});
