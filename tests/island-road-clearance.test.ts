import { expect, it, vi } from "vitest";

import { clearIslandRoadGround } from "../src/app/settlement/island-road-clearance";
import type { TerrainRenderer } from "../src/render-common/renderer-contract";
import { placeProp } from "../src/shared/world/editing/prop-placement";
import { BUILD, MATERIAL_COUNT, PROP, PROP_REMOVED, type WorldData } from "../src/shared/world/world-data";

it("clears rooted roadside flowers while keeping trees and neighboring plants intact", () => {
  const size = 12, vertices = (size + 1) ** 2;
  const world = { cellsX: size, cellsZ: size, seed: 7,
    heights: new Float32Array(vertices), splat: new Uint8Array(vertices * MATERIAL_COUNT),
    blocking: new Uint8Array(size ** 2), slopeClass: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildCap: new Uint8Array(size ** 2).fill(BUILD.large),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(4), x: new Float32Array(4), y: new Float32Array(4),
      z: new Float32Array(4), scale: new Float32Array(4), rotation: new Float32Array(4),
      phase: new Float32Array(4), form: new Uint8Array(4) }
  } as unknown as WorldData;
  const flower = placeProp(world, { kind: PROP.flowers, x: 5.5, z: 5.5, seed: 7 }) as number;
  const fern = placeProp(world, { kind: PROP.fern, x: 5.5, z: 6.5, seed: 7 }) as number;
  const tree = placeProp(world, { kind: PROP.broadleafTree, x: 6.5, z: 5.5, seed: 7 }) as number;
  const removeProps = vi.fn();
  const renderer = { mapEdit: { removeProps } } as unknown as TerrainRenderer;
  const splat = world.splat.slice();
  clearIslandRoadGround(world, renderer, [
    { start: { x: 4, z: 5.5 }, end: { x: 7, z: 5.5 }, tier: "dirt" }
  ]);
  expect(world.props.types[flower]).toBe(PROP_REMOVED);
  expect(world.props.types[fern]).toBe(PROP.fern);
  expect(world.props.types[tree]).toBe(PROP.broadleafTree);
  expect(removeProps).toHaveBeenCalledExactlyOnceWith([flower], { minX: 5, maxX: 5, minZ: 5, maxZ: 5 });
  expect(world.splat).toEqual(splat);
});
