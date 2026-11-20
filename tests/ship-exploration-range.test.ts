import { expect, it } from "vitest";

import { packFog, unpackFog } from "../src/shared/settlement/save-cell-codecs";
import { createNavalExploration } from "../src/shared/settlement/settlement-naval-exploration";
import type { NavalShip } from "../src/shared/settlement/settlement-naval-fleet";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { FOG, type WorldData } from "../src/shared/world/world-data";

it("reveals the enlarged circle continuously and preserves every fog cell through packed saves", () => {
  const world = { cellsX: 96, cellsZ: 96, fog: new Uint8Array(96 * 96) } as WorldData;
  const exploration = createNavalExploration({ options: { world } } as SettlementContext);
  const ship = { id: 1, x: 40.5, z: 40.5, phase: "sailing", passengers: [1],
    exploration: { points: [], cursor: 0, returning: false } } as unknown as NavalShip;
  const observed: number[] = [];
  exploration.discover([ship], (_x, _z, radius) => observed.push(radius));
  expect(observed).toEqual([15.6]);
  expect(world.fog[40 * 96 + 55]).toBe(FOG.discovered);
  expect(world.fog[40 * 96 + 56]).toBe(FOG.hidden);
  ship.x += 1;
  exploration.discover([ship]);
  expect(world.fog[40 * 96 + 56]).toBe(FOG.discovered);
  ship.phase = "unloading";
  exploration.discover([ship], (_x, _z, radius) => observed.push(radius));
  expect(observed.at(-1)).toBe(26);
  expect(world.fog[40 * 96 + 67]).toBe(FOG.discovered);
  expect(world.fog[40 * 96 + 68]).toBe(FOG.hidden);
  const restored = unpackFog(packFog(world.fog), world.fog.length);
  expect(restored).toEqual(world.fog);
  expect(restored.every(value => value !== FOG.visible)).toBe(true);
});

it("reveals along the approach to the harbour while the exploration ship is positioning", () => {
  const world = { cellsX: 48, cellsZ: 48, fog: new Uint8Array(48 * 48) } as WorldData;
  const reveal = createNavalExploration({ options: { world } } as SettlementContext);
  reveal.discover([{ id: 1, x: 16.5, z: 16.5, phase: "positioning", passengers: [1],
    exploration: { points: [], cursor: 0, returning: false } } as unknown as NavalShip]);
  expect(world.fog[16 * 48 + 31]).toBe(FOG.discovered);
});

it("does not reveal for visitors without a scout expedition, idle ships or empty crews", () => {
  const world = { cellsX: 32, cellsZ: 32, fog: new Uint8Array(32 * 32) } as WorldData;
  const reveal = createNavalExploration({ options: { world } } as SettlementContext);
  for (const patch of [{ exploration: undefined }, { passengers: [] }, { phase: "idle" }, { phase: "loading" }])
    reveal.discover([{ id: 1, x: 16.5, z: 16.5, phase: "sailing", passengers: [1],
      exploration: { points: [], returning: false }, ...patch } as unknown as NavalShip]);
  expect(world.fog.some(value => value !== FOG.hidden)).toBe(false);
});
