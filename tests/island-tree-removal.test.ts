import { expect, it, vi } from "vitest";

import { removeHarvestedTree } from "../src/app/island-tree-removal";
import { getCanopyField } from "../src/render-common/canopy-field";
import type { TerrainRenderer } from "../src/render-common/renderer-contract";
import { placeProp } from "../src/shared/world/editing/prop-placement";
import { BLOCKING, BUILD, MATERIAL_COUNT, PROP, PROP_REMOVED, type WorldData } from "../src/shared/world/world-data";

it("clears harvested props, root collision, canopy shade and renderer, then allows replanting", () => {
  const size = 12, vertices = (size + 1) ** 2;
  const world = {
    cellsX: size, cellsZ: size,
    heights: new Float32Array(vertices), splat: new Uint8Array(vertices * MATERIAL_COUNT),
    blocking: new Uint8Array(size ** 2), slopeClass: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildCap: new Uint8Array(size ** 2).fill(BUILD.large),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(4), x: new Float32Array(4), y: new Float32Array(4),
      z: new Float32Array(4), scale: new Float32Array(4), rotation: new Float32Array(4),
      phase: new Float32Array(4), form: new Uint8Array(4) }
  } as unknown as WorldData;
  const id = placeProp(world, { kind: PROP.broadleafTree, x: 5.5, z: 5.5, seed: 7 }) as number;
  const shade = getCanopyField(world);
  const cell = 5 * size + 5;
  expect(world.blocking[cell]).toBe(BLOCKING.prop);
  expect(Math.max(...shade)).toBeGreaterThan(0);
  const removeProps = vi.fn(), refreshChunks = vi.fn();
  const renderer = { mapEdit: { removeProps, refreshChunks } } as unknown as TerrainRenderer;
  removeHarvestedTree(world, renderer, id);
  expect(world.props.types[id]).toBe(PROP_REMOVED);
  expect(world.blocking[cell]).toBe(BLOCKING.free);
  expect(world.walkCost[cell]).toBe(10);
  expect(Math.max(...shade)).toBe(0);
  expect(removeProps).toHaveBeenCalledTimes(1);
  expect(refreshChunks).toHaveBeenCalledTimes(1);
  removeHarvestedTree(world, renderer, id);
  expect(removeProps).toHaveBeenCalledTimes(1);
  expect(typeof placeProp(world, { kind: PROP.broadleafTree, x: 5.5, z: 5.5, seed: 9 })).toBe("number");
  expect(world.blocking[cell]).toBe(BLOCKING.prop);
});
