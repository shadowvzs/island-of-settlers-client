import { Box3, Mesh } from "three";
import { expect, it, vi } from "vitest";

import {
  CHEST_COIN_DIAMETER, CHEST_COIN_THICKNESS, COIN_CHEST,
  createCoinChestPacking, splitShipCoinChests, visibleChestCoins
} from "../src/render-common/logistics/coin-chest";
import { COIN_DIAMETER, COIN_THICKNESS } from "../src/render-common/wares/ware-coin-recipe";
import { createCoinChestModel } from "../src/renderers/three/settlement/coin-chest-model";
import { wareBoxUnits } from "../src/shared/settlement/ship-cargo-boxes";

it("retains exact finite coins while rendering only bounded exposed layers", () => {
  for (const units of [0, 1, 18, 50, 150, 249, 250]) {
    const packing = createCoinChestPacking(units);
    expect(packing).toHaveLength(units);
    for (const detailed of [true, false]) {
      const visible = visibleChestCoins(packing, detailed);
      expect(visible.length).toBeLessThanOrEqual(Math.min(units, detailed ? 36 : 18));
      expect(visible.filter(coin => coin.top)).toHaveLength(packing.filter(coin => coin.top).length);
    }
  }
  for (const units of [-1, .5, 251, NaN, Infinity]) expect(() => createCoinChestPacking(units)).toThrow(/quantity/);
});

it("packs full coins below rim with walls and a supported base at identical physical scale", () => {
  const packing = createCoinChestPacking(250), radius = CHEST_COIN_DIAMETER / 2;
  expect(CHEST_COIN_DIAMETER / COIN_DIAMETER).toBe(CHEST_COIN_THICKNESS / COIN_THICKNESS);
  const columns = packing.filter(coin => coin.layer === 0);
  for (const first of columns) for (const second of columns) {
    if (first.column === second.column) continue;
    // Even two maximum top inclinations cannot bridge this intentional lateral gap.
    expect(Math.hypot(first.x - second.x, first.z - second.z))
      .toBeGreaterThan(CHEST_COIN_DIAMETER + CHEST_COIN_THICKNESS * Math.sin(.06) * 2);
  }
  for (const coin of packing) {
    const tilt = Math.hypot(coin.pitch, coin.roll);
    const halfHeight = CHEST_COIN_THICKNESS / 2 + radius * Math.sin(tilt);
    expect(Math.abs(coin.x) + radius + CHEST_COIN_THICKNESS * Math.sin(tilt)).toBeLessThan(COIN_CHEST.width / 2 - COIN_CHEST.wall);
    expect(Math.abs(coin.z) + radius + CHEST_COIN_THICKNESS * Math.sin(tilt)).toBeLessThan(COIN_CHEST.depth / 2 - COIN_CHEST.wall);
    expect(coin.y + halfHeight).toBeLessThan(COIN_CHEST.height - COIN_CHEST.rimClearance);
    expect(coin.y - halfHeight).toBeCloseTo(COIN_CHEST.floor + coin.layer * CHEST_COIN_THICKNESS, 8);
    if (coin.layer) expect(packing.some(other => other.column === coin.column && other.layer === coin.layer - 1)).toBe(true);
  }
});

it("ships retain the existing250-unit chest size, including every partial remainder", () => {
  expect(COIN_CHEST.capacity).toBe(wareBoxUnits("coins"));
  expect(splitShipCoinChests(0)).toEqual([]);
  expect(splitShipCoinChests(1)).toEqual([1]);
  expect(splitShipCoinChests(150)).toEqual([150]);
  expect(splitShipCoinChests(250)).toEqual([250]);
  expect(splitShipCoinChests(300)).toEqual([250, 50]);
  expect(splitShipCoinChests(1000)).toEqual([250, 250, 250, 250]);
  expect(splitShipCoinChests(1250)).toEqual([250, 250, 250, 250, 250]);
  expect(() => splitShipCoinChests(2_500_001)).toThrow(/bounded/);
  for (const units of [-1, .5, NaN, Infinity]) expect(() => splitShipCoinChests(units)).toThrow(/quantity/);
});

it("both LODs keep one coherent chest envelope, finite merged draws and independent disposal", () => {
  for (const detailed of [true, false]) for (const lid of ["open", "closed", "none"] as const) {
    const model = createCoinChestModel({ detailed, lid, units: 250 });
    const bounds = new Box3().setFromObject(model.root);
    expect(bounds.min.y).toBeGreaterThanOrEqual(-1e-6);
    expect(bounds.max.x - bounds.min.x).toBeLessThan(.60);
    expect(model.root.children.length).toBeLessThanOrEqual(4);
    expect(model.triangles).toBeLessThan(detailed ? 11000 : 3000);
    const disposals = model.root.children.map(child => vi.spyOn((child as Mesh).geometry, "dispose"));
    model.dispose(); model.dispose();
    expect(model.root.children).toHaveLength(0);
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
  }
});

it("continues every exposed full stack down to the chest floor instead of floating upper discs", () => {
  for (const detailed of [true, false]) for (const units of [50, 150, 250]) {
    const model = createCoinChestModel({ detailed, lid: "none", units });
    const gold = model.root.getObjectByName("gold") as Mesh;
    gold.geometry.computeBoundingBox();
    expect(gold.geometry.boundingBox!.min.y).toBeCloseTo(COIN_CHEST.floor, 6);
    expect(gold.geometry.boundingBox!.max.y).toBeLessThan(COIN_CHEST.height - COIN_CHEST.rimClearance);
    model.dispose();
  }
});
