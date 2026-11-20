import { expect, it } from "vitest";

import { appendProp } from "../src/shared/world/editing/prop-set";
import { explainWorldNavigationChange } from "../src/shared/world/navigation-change-log";
import { propIndexWork, somePropInCell, somePropNear } from "../src/shared/world/prop-cell-index";
import type { PropSet, WorldData } from "../src/shared/world/world-data";

const SIZE = 40;
const createWorld = (count: number) => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const props: PropSet = { count, form: new Uint8Array(count), phase: new Float32Array(count),
    rotation: new Float32Array(count), scale: new Float32Array(count).fill(1), types: new Uint8Array(count).fill(1),
    x: Float32Array.from({ length: count }, () => random() * SIZE),
    y: new Float32Array(count), z: Float32Array.from({ length: count }, () => random() * SIZE) };
  return { cellsX: SIZE, cellsZ: SIZE, props } as unknown as WorldData;
};

const near = (world: WorldData, x: number, z: number, radius: number) => {
  const visited: number[] = [];
  somePropNear(world, x, z, radius, (index) => { visited.push(index); return false; });
  return visited;
};

it("visits every prop within the radius (a superset), exactly once", () => {
  const world = createWorld(3000);
  for (const [x, z, radius] of [[20, 20, 10], [1, 2, 10], [39.5, 0.5, 3], [10.2, 30.7, 0.4]] as const) {
    const visited = near(world, x, z, radius);
    expect(new Set(visited).size).toBe(visited.length);
    for (let index = 0; index < world.props.count; index++)
      if (Math.hypot(world.props.x[index]! - x, world.props.z[index]! - z) <= radius)
        expect(visited).toContain(index);
    expect(visited.length).toBeLessThan(world.props.count);
  }
});

/** The same props in a fresh world: a cold index of the same data. */
const cloneWorld = (world: WorldData) => ({ ...world, buildRevision: world.buildRevision,
  props: { ...world.props, types: world.props.types.slice(), x: world.props.x.slice(), z: world.props.z.slice() } }) as WorldData;
const tile = (x: number, z: number) => ({ maxX: x, maxZ: z, minX: x, minZ: z });

it("files props appended by explained changes per cell in a cold build's order without rebuilding", () => {
  const world = createWorld(300);
  world.buildRevision = 0;
  near(world, 20, 20, 5);
  const builds = propIndexWork.builds;
  for (let step = 0; step < 3; step++)
    explainWorldNavigationChange(world, tile(5, 5), () => appendProp(world.props,
      { form: 0, phase: 0, rotation: 0, scale: 1, type: 1, x: 5.2 + step * .1, y: 0, z: 5.5 }));
  const warm = near(world, 5.5, 5.5, 2);
  expect(propIndexWork.builds).toBe(builds);
  expect(warm).toEqual(near(cloneWorld(world), 5.5, 5.5, 2));
  expect(warm.filter(index => index >= 300)).toEqual([300, 301, 302]);
});

it("rebuilds after an unexplained world change and answers one cell", () => {
  const world = createWorld(100);
  world.buildRevision = 0;
  near(world, 1, 1, 1);
  const builds = propIndexWork.builds;
  world.buildRevision = 1;
  const cell = 7 * SIZE + 3, inCell: number[] = [];
  somePropInCell(world, cell, index => { inCell.push(index); return false; });
  expect(propIndexWork.builds).toBe(builds + 1);
  const expected = Array.from({ length: world.props.count }, (_, index) => index).filter(index =>
    Math.floor(world.props.z[index]!) * SIZE + Math.floor(world.props.x[index]!) === cell);
  expect(inCell).toEqual(expected);
});

it("stops at the first match and sees props appended later", () => {
  const world = createWorld(200);
  let calls = 0;
  expect(somePropNear(world, 20, 20, 30, () => ++calls === 3)).toBe(true);
  expect(calls).toBe(3);
  expect(near(world, 5.5, 5.5, 0.2)).not.toContain(200);
  appendProp(world.props, { form: 0, phase: 0, rotation: 0, scale: 1, type: 1, x: 5.5, y: 0, z: 5.5 });
  expect(near(world, 5.5, 5.5, 0.2)).toContain(200);
});
