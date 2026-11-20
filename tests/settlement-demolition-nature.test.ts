import { expect, it, vi } from "vitest";

import { createIslandBuildingClearance } from "../src/app/settlement/island-building-clearance";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { placeProp } from "../src/shared/world/editing/prop-placement";
import { removePropsAt } from "../src/shared/world/editing/prop-removal";
import {
  BUILD,
  MATERIAL_COUNT,
  PROP,
  PROP_REMOVED,
  type WorldData
} from "../src/shared/world/world-data";
it("restores only this plan's original bushes, releases wildlife exclusion, never resurrects trees or animals", () => {
  const size = 32,
    world = {
      cellsX: size,
      cellsZ: size,
      seed: 7,
      heights: new Float32Array((size + 1) ** 2),
      waterDepth: new Float32Array((size + 1) ** 2),
      splat: new Uint8Array((size + 1) ** 2 * MATERIAL_COUNT),
      blocking: new Uint8Array(size ** 2),
      slopeClass: new Uint8Array(size ** 2),
      walkCost: new Uint8Array(size ** 2).fill(10),
      buildCap: new Uint8Array(size ** 2).fill(BUILD.large),
      buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
      props: {
        count: 0,
        types: new Uint8Array(4),
        x: new Float32Array(4),
        y: new Float32Array(4),
        z: new Float32Array(4),
        scale: new Float32Array(4),
        rotation: new Float32Array(4),
        phase: new Float32Array(4),
        form: new Uint8Array(4)
      }
    } as unknown as WorldData;
  const bush = placeProp(world, { kind: PROP.bush, x: 15.5, z: 15.5, seed: 7 }) as number;
  const tree = placeProp(world, { kind: PROP.broadleafTree, x: 16.5, z: 15.5, seed: 7 }) as number;
  const refreshPlacedProps = vi.fn(),
    releaseConstructionGround = vi.fn(),
    setExcluded = vi.fn();
  const options = {
    world,
    renderer: {
      mapEdit: {
        refreshPlacedProps,
        releaseConstructionGround,
        reserveConstructionGround: vi.fn(),
        removeProps: vi.fn(),
        previewRegion: vi.fn(),
        refreshChunks: vi.fn()
      }
    },
    animals: { manager: { setExcluded, relocateFrom: vi.fn(), refreshHomes: vi.fn(), touchArea: vi.fn() } },
    felling: { removeTrees: vi.fn() },
    growth: { remove: vi.fn() }
  };
  const hook = createIslandBuildingClearance(
    options as unknown as Parameters<typeof createIslandBuildingClearance>[0]
  );
  // A Forester/editor tree added after initialization uses the separately refreshed placed layer.
  const planted = placeProp(world, {kind:PROP.broadleafTree,x:16.5,z:16.5,seed:19}) as number;
  const building = {
    typeId: 17,
    x: 16,
    z: 16,
    width: 4,
    depth: 4,
    rotation: 0,
    clearedProps: [
      { index: bush, type: PROP.bush },
      { index: tree, type: PROP.broadleafTree },
      { index: planted, type: PROP.broadleafTree }
    ]
  } as SettlementBuilding;
  removePropsAt(world, [bush, tree, planted]);
  hook(building, [bush, tree, planted]);
  expect(refreshPlacedProps).toHaveBeenCalledWith(2);
  expect(options.growth.remove).toHaveBeenCalledWith([bush, tree, planted]);
  expect(options.felling.removeTrees).toHaveBeenCalledWith([bush, tree, planted],false);
  const excluded = setExcluded.mock.calls[0]![0] as (x: number, z: number) => boolean;
  expect(excluded(15.5, 15.5)).toBe(true);
  hook.demolish(building);
  expect(world.props.types[bush]).toBe(PROP.bush);
  expect(world.props.types[tree]).toBe(PROP_REMOVED);
  expect(excluded(15.5, 15.5)).toBe(false);
  expect(world.props.count).toBe(3);
  expect(world.props.types[planted]).toBe(PROP_REMOVED);
  expect(releaseConstructionGround).toHaveBeenCalledOnce();
  expect(refreshPlacedProps).toHaveBeenCalledWith(2);
  expect(options.animals.manager.refreshHomes).toHaveBeenLastCalledWith(expect.anything(), {
    added: [bush],
    removed: []
  });
});
