import { describe, expect, it } from "vitest";

import { CIVILIAN_THREAT_RADIUS } from "../src/shared/settlement/military-civilian-safety";
import { advance, type AssaultSimulation, ENEMY, villageFixture } from "./helpers/military-assault-fixture";

/**
 * MIL-ASSAULT (owner 2026-11-09), free play: computer soldiers attack every player civilian outside a
 * building; civilians flee from raiders within `CIVILIAN_THREAT_RADIUS` and stay inside while raiders
 * stand near their building's door. A save taken mid-raid continues byte-identically.
 */
const deathsOf = (sim: AssaultSimulation) => sim.saveState().military?.combat?.civilianDeaths ?? 0;
const isCivilian = (actor: { job: string }) => actor.job !== "Soldier";
const fleeing = (sim: AssaultSimulation) => sim.frames().filter(actor => isCivilian(actor) && actor.visible &&
  (actor.demolitionReturning || actor.phase === "civilianEscape")).length;

const raidRoad = (sim: AssaultSimulation, site: { access: { x: number; z: number } }) => {
  const { access } = sim.headquarters;
  const middle = { x: (access.x + site.access.x) / 2, z: (access.z + site.access.z) / 2 + 1.5 };
  const raiders = [0, 1, 2].map(index =>
    sim.spawnMilitaryOpponent({ x: middle.x + index * .8, z: middle.z }, "heavy", 0, ENEMY));
  expect(raiders.every(id => id !== null)).toBe(true);
  return raiders as number[];
};

describe("MIL-ASSAULT: raiders and civilians outside buildings", () => {
  it("villagers on the road flee; people lost stay lost; a mid-raid save replays identically", () => {
    const { sim, site } = villageFixture();
    advance(sim, 15);
    expect(sim.frames().some(actor => isCivilian(actor) && actor.visible)).toBe(true);
    raidRoad(sim, site);
    let fled = 0;
    for (let tick = 0; tick < 100; tick++) { sim.update(.05); fled = Math.max(fled, fleeing(sim)); }
    expect(fled).toBeGreaterThan(0);
    const saved = JSON.stringify(sim.saveState());
    advance(sim, 60);
    // People are lost for good: the live count matches a fresh recount after a load.
    const people = sim.population().people;
    expect(sim.loadState(sim.saveState())).toEqual({ ok: true });
    expect(sim.population().people).toBe(people);
    expect(deathsOf(sim)).toBeLessThanOrEqual(2);
    const runFrom = () => {
      expect(sim.loadState(JSON.parse(saved))).toEqual({ ok: true });
      advance(sim, 20);
      return JSON.stringify(sim.saveState());
    };
    expect(runFrom()).toBe(runFrom());
  }, 240_000);

  it("keeps civilians inside while raiders stand at the door, and lets them out once they leave", () => {
    const { sim } = villageFixture();
    advance(sim, 5);
    const door = sim.headquarters.doorThreshold;
    const raiders = [0, 1].map(index => sim.spawnMilitaryOpponent({ x: door.x + 3 + index, z: door.z + 3 },
      "heavy", 0, ENEMY)) as number[];
    expect(raiders.every(id => id !== null)).toBe(true);
    advance(sim, 3);
    const nearDoor = () => sim.frames().filter(actor => isCivilian(actor) && actor.visible &&
      Math.hypot(actor.x - door.x, actor.z - door.z) < 1.2).length;
    let seen = 0;
    for (let tick = 0; tick < 600; tick++) { sim.update(.05); seen = Math.max(seen, nearDoor()); }
    expect(seen).toBe(0);
    expect(sim.commandMilitaryOpponent(raiders, { x: 58, z: 58 }, ENEMY, "move")).toBe(true);
    let out = 0;
    for (let tick = 0; tick < 1200 && !out; tick++) {
      sim.update(.05);
      const far = sim.frames().filter(actor => raiders.includes(actor.uid))
        .every(actor => Math.hypot(actor.x - door.x, actor.z - door.z) > CIVILIAN_THREAT_RADIUS);
      if (far) out = nearDoor();
    }
    expect(out).toBeGreaterThan(0);
  }, 240_000);
});
