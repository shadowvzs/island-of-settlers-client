import { expect, it } from "vitest";

import { createIslandResources } from "../src/app/settlement/island-resource-hooks";
import type { ResourceTarget } from "../src/shared/settlement/settlement-types";
import { PROP } from "../src/shared/world/world-data";
import { huntingWorld } from "./helpers/hunting-world";

it("plants the actual requested hardwood species while ordinary nursery regrowth follows tropical ecology", () => {
  const world = huntingWorld();
  world.expeditionKind = "colony"; world.expeditionTheme = "tropical";
  world.coastDistance.fill(10); world.waterDepth.fill(0);
  const added: number[] = [], growing: number[] = [];
  const { hooks } = createIslandResources({ world,
    renderer: {},
    animals: { manager: {
      debug: { pool: {} }, onAnimalRemoved: () => {}, script: { pinCells: () => {} }, setExcluded: () => {}
    } },
    felling: { addTrees: (ids: number[]) => added.push(...ids) },
    growth: { onStage: () => {}, plant: (id: number) => growing.push(id) }
  } as unknown as Parameters<typeof createIslandResources>[0]);
  // The target's string kind must not overwrite placeProp's numeric species via object spread.
  const ordinary: ResourceTarget = { id: 1, kind: "plant", x: 20.5, z: 20.5 };
  expect(hooks.onPlantTree!(ordinary)).toBe(true);
  expect(world.props.types[0]).toBe(PROP.palmTree);
  const hardwood: ResourceTarget = { id: 2, kind: "plant", treeSpecies: "broadleafTree", x: 25.5, z: 20.5 };
  expect(hooks.onPlantTree!(hardwood)).toBe(true);
  expect(world.props.types[1]).toBe(PROP.broadleafTree);
  expect(added).toEqual([0, 1]); expect(growing).toEqual([0, 1]);
});
