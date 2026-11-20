import { describe, expect, it } from "vitest";

import { constructionStockApproach } from "../src/app/settlement/construction-stock-approach";
import { PROP, type WorldData } from "../src/shared/world/world-data";

const world = () => ({
  buildRevision: 1,
  cellsX: 16,
  cellsZ: 16,
  blocking: new Uint8Array(16 * 16),
  heights: new Float32Array(17 * 17),
  props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() },
  walkCost: new Uint8Array(16 * 16).fill(10)
}) as unknown as WorldData;

describe("construction stock approach", () => {
  it("does not hand off inside a neighbouring building plot", () => {
    const access = { x: 5, z: 5 }, stock = { x: 6, z: 4 }, nominal = { x: 6, z: 6 };
    const occupied = (x: number, z: number) => x >= 5.5 && z >= 5.5;
    const approach = constructionStockApproach(world(), access, stock, nominal, occupied);

    expect(approach).not.toEqual(nominal);
    expect(occupied(approach.x, approach.z)).toBe(false);
  });

  it("moves a blocked nominal approach to a free side when one exists", () => {
    const access = { x: 5, z: 5 }, stock = { x: 6, z: 4 }, nominal = { x: 6, z: 6 };
    const approach = constructionStockApproach(world(), access, stock, nominal,
      (x, z) => x === nominal.x && z === nominal.z);

    expect(approach).not.toEqual(nominal);
  });

  it("uses the clear access instead of a physically blocked pile stance when every side is unavailable", () => {
    const terrain = world();
    terrain.props = { count: 1, types: new Uint8Array([PROP.coniferTree]),
      x: new Float32Array([6]), z: new Float32Array([6]), scale: new Float32Array([1]) } as WorldData["props"];
    const access = { x: 5, z: 5 }, nominal = { x: 6, z: 6 }, stock = { x: 6, z: 5 };
    const occupied = (x: number, z: number) => Math.hypot(x - access.x, z - access.z) > .05 &&
      Math.hypot(x - nominal.x, z - nominal.z) > .05;

    expect(constructionStockApproach(terrain, access, stock, nominal, occupied)).toEqual(access);
  });

});
