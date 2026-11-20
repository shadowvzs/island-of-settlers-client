import { describe, expect, it } from "vitest";

import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import { REPLAY_COMMANDS } from "../src/shared/settlement/settlement-commands";
import { createBalanceSimulation } from "../tools/bench/garrison-balance-harness";

const fixture = (deployed = true) => {
  const simulation = createBalanceSimulation(48, 123);
  simulation.receiveTroops([{ type: "shield", rank: 2, hp: militaryHealth("shield", 2) }]);
  if (deployed) {
    const id = simulation.militarySoldiers()[0]!.actor;
    expect(simulation.commandMilitary([id], { x: 23, z: 23 }, "move")).toBe(true);
    for (let tick = 0; tick < 90 * 20; tick++) simulation.update(0.05);
    expect(simulation.frames().find((actor) => actor.uid === id)?.phase).toBe("militaryField");
  }
  return simulation;
};

describe("restored opt-in bounded debug skirmish", () => {
  it("requires a deployed friendly soldier and does not grant player troops or equipment", () => {
    const simulation = fixture(false),
      before = simulation.saveState();
    expect(simulation.startMilitaryTestSkirmish()).toEqual([]);
    expect(simulation.saveState()).toEqual(before);
    expect(REPLAY_COMMANDS).toContain("startMilitaryTestSkirmish");
  });
  it("spawns the historical shield/heavy/archer faction1 trio and deduplicates until every enemy is gone", () => {
    const simulation = fixture(),
      stock = { ...simulation.headquarters.inventory };
    const friendly = simulation
      .militarySoldiers()
      .filter((soldier) => soldier.combat?.faction === 0)
      .map((soldier) => soldier.actor);
    const ids = simulation.startMilitaryTestSkirmish();
    expect(ids).toHaveLength(3);
    const enemies = simulation.militarySoldiers().filter((soldier) => ids.includes(soldier.actor));
    expect(enemies.map((soldier) => soldier.combat?.type)).toEqual(["shield", "heavy", "archer"]);
    expect(enemies.every((soldier) => soldier.combat?.faction === 1 && soldier.rank === 0)).toBe(
      true
    );
    for (let repeat = 0; repeat < 5; repeat++)
      expect(simulation.startMilitaryTestSkirmish()).toEqual([]);
    expect(simulation.headquarters.inventory).toEqual(stock);
    expect(
      simulation
        .militarySoldiers()
        .filter((soldier) => soldier.combat?.faction === 0)
        .map((soldier) => soldier.actor)
    ).toEqual(friendly);
    const checkpoint = JSON.parse(JSON.stringify(simulation.saveState()));
    expect(simulation.loadState(checkpoint)).toEqual({ ok: true });
    expect(simulation.startMilitaryTestSkirmish()).toEqual([]);
    expect(
      simulation
        .militarySoldiers()
        .filter((soldier) => soldier.combat?.faction === 1)
        .map((soldier) => soldier.actor)
    ).toEqual(ids);
  });
  it("does not add a second fixture beside any existing hostile faction", () => {
    const simulation = fixture();
    expect(simulation.spawnMilitaryOpponent({ x: 38, z: 38 }, "shield", 0, 2)).not.toBeNull();
    expect(simulation.startMilitaryTestSkirmish()).toEqual([]);
    expect(
      simulation.militarySoldiers().filter((soldier) => (soldier.combat?.faction ?? 0) > 0)
    ).toHaveLength(1);
  });
  it("refuses unreachable spawn positions without modifying troop counts", () => {
    let isolate = () => {};
    const simulation = createBalanceSimulation(48, 123, { x: 6.5, z: 6.5 }, (world) => {
      // Keep normal HQ placement; isolate only after the scripted defender exists.
      isolate = () => { world.walkCost.fill(0); world.walkCost[23 * 48 + 23] = 10; };
    });
    simulation.receiveTroops([{ type: "shield", rank: 0, hp: militaryHealth("shield", 0) }]);
    const actor = simulation.frames().find((actor) => actor.job === "Soldier")!;
    actor.phase = "militaryField";
    actor.visible = true;
    actor.x = actor.z = 23.5; isolate();
    const count = simulation.militarySoldiers().length;
    expect(simulation.startMilitaryTestSkirmish()).toEqual([]);
    expect(simulation.militarySoldiers()).toHaveLength(count);
  });
});
