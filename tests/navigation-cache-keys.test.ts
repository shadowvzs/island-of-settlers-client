import { expect, it } from "vitest";

import { connectivityRevision, routeRevision } from "../src/shared/settlement/military-long-routes";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const contextWith = (decorationRevision: number) => {
  const size = 32;
  const world = { seed: 1, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 4, z: 4 },
    buildRevision: 1, terrainRevision: 1, heights: new Float32Array((size + 1) ** 2),
    blocking: new Uint8Array(size ** 2), walkCost: new Uint8Array(size ** 2).fill(10),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large), oreAmount: new Uint8Array(size ** 2),
    mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      scale: new Float32Array() } } as unknown as WorldData;
  let revision = decorationRevision;
  return { context: { options: { world }, buildings: [], actors: [], occupied: new Uint8Array(size ** 2),
    navigationRevision: 3, roadDecorations: { revision: () => revision } } as unknown as SettlementContext,
  setRevision: (value: number) => { revision = value; }, world };
};

it("changes the route and connectivity keys when a road decoration is placed", () => {
  const { context, setRevision, world } = contextWith(1);
  const routes = routeRevision(context), connectivity = connectivityRevision(context);
  setRevision(2);
  expect(routeRevision(context)).not.toBe(routes);
  expect(connectivityRevision(context)).not.toBe(connectivity);
  world.props.count = 1;
  expect(connectivityRevision(context)).not.toBe(connectivity);
});

it("keeps the connectivity key independent of a building stock change", () => {
  const { context, world } = contextWith(4);
  const before = connectivityRevision(context);
  context.navigationRevision = 9;
  expect(connectivityRevision(context)).not.toBe(before);
  world.props.count = 2;
  expect(routeRevision(context)).toContain(":2:");
});
