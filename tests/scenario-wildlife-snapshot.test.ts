import { describe, expect, it } from "vitest";

import { getIslandHuntingTargets } from "../src/app/settlement/island-hunting-targets";
import { createAnimalManager } from "../src/render-common/wildlife/animal-manager";
import { createIslandNav } from "../src/render-common/wildlife/nav/island-nav";
import { ISLAND_ANIMAL_CAP } from "../src/render-common/wildlife/population/wildlife-regions";
import { SPECIES } from "../src/render-common/wildlife/wildlife-species";
import { createScenarioWildlifeSnapshot, MAX_INSPECTION_PREY, validScenarioWildlife } from "../src/shared/settlement/scenario-wildlife-inspection";
import { forestWorld } from "./helpers/forest-world";
import { huntingWorld } from "./helpers/hunting-world";

describe("native wildlife worker snapshot", () => {
  it("copies only actual living adult prey, excluding juvenile, pending, dead and inactive slots", () => {
    const world = huntingWorld(), manager = createAnimalManager(world, createIslandNav(world, []));
    const { pool } = manager.debug;
    for (const [x, z, age] of [[30, 30, 1], [34, 28, .1], [44, 32, 1]] as const) {
      expect(manager.placeAnimal(SPECIES.deer, x, z, age)).toBe(true);
    }
    for (let tick = 0; tick < 40; tick++) manager.step();
    manager.killAnimal(ISLAND_ANIMAL_CAP + 2);
    expect(manager.placeAnimal(SPECIES.deer, 40, 22, 1)).toBe(true);
    const targets = getIslandHuntingTargets(manager);
    expect(targets).toEqual([{ id: ISLAND_ANIMAL_CAP, kind: "wildlife", x: pool.x[ISLAND_ANIMAL_CAP]!,
      z: pool.z[ISLAND_ANIMAL_CAP]! }]);
    const snapshot = createScenarioWildlifeSnapshot(targets);
    const copied = snapshot.targets[0]!.x;
    pool.x[ISLAND_ANIMAL_CAP] = 40; targets[0]!.x = 30;
    expect(snapshot.targets[0]!.x).toBe(copied);
    expect(validScenarioWildlife(structuredClone(snapshot), { cellsX: 64, cellsZ: 64 })).toBe(true);
    expect(pool.age[ISLAND_ANIMAL_CAP + 1]).toBeCloseTo(.1);
  });
  it("lists dormant adults at their routine pose without waking any region", () => {
    const world = forestWorld(64, 1.8), manager = createAnimalManager(world, createIslandNav(world, []));
    manager.step();
    const targets = getIslandHuntingTargets(manager);
    expect(targets.length).toBeGreaterThan(0);
    expect(manager.countSimulatedRegions()).toBe(0);
    expect(manager.countHuntable()).toBe(targets.length);
    for (const target of targets) expect(manager.debug.identity.dormant[target.id]).toBe(1);
  });
  it("fails closed on oversized snapshots rather than posting unbounded data or sampling a false absence", () => {
    const targets = Array.from({ length: MAX_INSPECTION_PREY + 1 }, (_, id) =>
      ({ id, kind: "wildlife" as const, x: 10, z: 10 }));
    const snapshot = createScenarioWildlifeSnapshot(targets);
    expect(snapshot).toEqual({ source: "native-current-pool", targets: [], overflow: true });
    expect(validScenarioWildlife(snapshot, { cellsX: 64, cellsZ: 64 })).toBe(false);
  });
});
