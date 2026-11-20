import { Box3, InstancedMesh, Matrix4, MeshStandardMaterial, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";

import { SAILING_SHIP_SCALE } from "../src/render-common/ships/ship-dimensions";
import { cargoCarryWare, COIN_CHEST_WARE, getWareCarryAction, resolveWareId } from "../src/render-common/wares/ware-catalog";
import { createCoinChestInstances } from "../src/renderers/three/settlement/coin-chest-instances";
import { createSmallBoatCoinCargo } from "../src/renderers/three/settlement/small-boat-coin-cargo";
import { createThreeSettlementShips } from "../src/renderers/three/settlement/three-ships";
import type { NavalShip } from "../src/shared/settlement/settlement-naval-fleet";
import { shipFrame } from "../src/shared/settlement/settlement-naval-ship-handling";
import { type CargoBox, cargoBoxes, wareBoxUnits } from "../src/shared/settlement/ship-cargo-boxes";
import { planCargoHandling, porterCargoIndices, porterPlaceAt } from "../src/shared/settlement/ship-cargo-handling";
import { cargoPresentation, deckCargoPresentation } from "../src/shared/settlement/ship-cargo-presentation";

const boxBounds = (root: import("three").Object3D) => {
  const meshes: InstancedMesh[] = [];
  root.traverse(child => { if (child instanceof InstancedMesh && child.count) meshes.push(child); });
  const count = meshes[0]?.count ?? 0, matrix = new Matrix4();
  return Array.from({ length: count }, (_, index) => {
    const bounds = new Box3();
    for (const mesh of meshes) {
      mesh.geometry.computeBoundingBox(); mesh.getMatrixAt(index, matrix);
      bounds.union(mesh.geometry.boundingBox!.clone().applyMatrix4(matrix));
    }
    return bounds;
  });
};
const ship = (cargo: Record<string, number>): NavalShip => ({ id: 1, x: 0, y: 0, z: 0, yaw: 0,
  phase: "sailing", cargo, cargoCount: Object.values(cargo).reduce((sum, count) => sum + count, 0),
  cursor: 0, route: [], timer: 0 });

describe("coin cargo uses existing exact economic boxes", () => {
  it.each([1, 50, 250, 300, 1000])("renders a finite %i-coin manifest without mutating saved ship state", count => {
    const vessel = ship({ coins: count }), before = JSON.stringify(vessel);
    const manifest = shipFrame(vessel).cargoManifest!;
    expect(manifest.reduce((sum, box) => sum + box.count, 0)).toBe(count);
    expect(manifest).toHaveLength(Math.ceil(count / 250));
    expect(manifest.every(box => box.ware === "coins" && box.count > 0 && box.count <= 250)).toBe(true);
    expect(wareBoxUnits("coins")).toBe(250);
    expect(cargoBoxes(vessel.cargo)).toBe(Math.ceil(count / 250));
    for (let index = 0; index < 10; index++) shipFrame(vessel);
    expect(JSON.stringify(vessel)).toBe(before);
    expect(resolveWareId(COIN_CHEST_WARE)).toBeNull();
  });

  it("retains exact coin identity through transfer prefixes, unloading suffixes and live manifest changes", () => {
    const cargo = { coins: 300, planks: 30 }, manifest = cargoPresentation(cargo, 3);
    expect(manifest).toEqual([{ count: 250, ware: "coins" }, { count: 50, ware: "coins" }, { count: 30, ware: "planks" }]);
    expect(cargoPresentation(cargo, 3)).toBe(manifest);
    expect(deckCargoPresentation(manifest, 2, false)).toEqual(manifest.slice(0, 2));
    expect(deckCargoPresentation(manifest, 1, true)).toEqual([{ count: 30, ware: "planks" }]);
    cargo.coins = 1;
    expect(cargoPresentation(cargo, 2)).toEqual([{ count: 1, ware: "coins" }, { count: 30, ware: "planks" }]);
    expect(manifest[0]!.count).toBe(250);
  });

  it("does not overfill visible visitor chests or change the existing unlimited visitor ledger", () => {
    const vessel: NavalShip = { ...ship({ coins: 25_000 }),
      visitor: { exit: { x: 0, z: 0 }, pickup: [], role: "supply" } };
    const before = JSON.stringify(vessel), frame = shipFrame(vessel);
    expect(frame.deckBoxes).toBe(33);
    expect(frame.cargoManifest).toHaveLength(33);
    expect(frame.cargoManifest!.every(box => box.count === 250)).toBe(true);
    expect(cargoBoxes(vessel.cargo)).toBe(100);
    expect(vessel.cargo.coins).toBe(25_000);
    expect(JSON.stringify(vessel)).toBe(before);
  });

  it("keeps the actual two-box porter trip as two chests or a correctly ordered mixed stack", () => {
    const plan = planCargoHandling(26, 12, 0);
    expect(plan.perTrip).toBe(2);
    const observed = new Set<number>();
    for (let elapsed = 0; elapsed < plan.seconds; elapsed += .1) for (let porter = 0; porter < plan.porters; porter++) {
      const place = porterPlaceAt(plan, porter, elapsed, false);
      if (!place?.carrying) continue;
      const indices = porterCargoIndices(plan, porter, elapsed);
      expect(indices.length).toBeGreaterThan(0); expect(indices.length).toBeLessThanOrEqual(2);
      indices.forEach(index => { expect(index).toBeLessThan(26); observed.add(index); });
    }
    expect(observed.size).toBe(26);
    expect(cargoCarryWare("coins")).toBe(COIN_CHEST_WARE);
    expect(cargoCarryWare("coins", "coins")).toBe("coinChestStack");
    expect(cargoCarryWare("coins", "planks")).toBe("coinChestUnderCrate");
    expect(cargoCarryWare("planks", "coins")).toBe("coinChestOverCrate");
    expect(getWareCarryAction("coinChestStack")).toBe("carry_shoulder");
  });
});

describe("closed coin cargo geometry", () => {
  it.each(["high", "minimal"] as const)("uses shared bounded ship instances and seats every stacked %s chest", quality => {
    const layer = createThreeSettlementShips(quality), vessel = ship({ coins: 1500 });
    layer.update([shipFrame(vessel)], [], 0, { playerNation: "roman" });
    const cargo = layer.group.getObjectByName("coin_cargo_chests")!;
    const bounds = boxBounds(cargo);
    expect(bounds).toHaveLength(6);
    for (const box of bounds) expect(box.getSize(new Vector3()).x * SAILING_SHIP_SCALE).toBeLessThan(.6);
    expect(bounds[1]!.min.y).toBeCloseTo(bounds[0]!.max.y, 6);
    expect(bounds[2]!.min.y).toBeCloseTo(bounds[1]!.max.y, 6);
    expect(cargo.children).toHaveLength(2);
    layer.update([{ ...shipFrame(vessel), id: 2 }], [], 1, { playerNation: "roman" });
    expect(layer.group.getObjectByName("ship-1")).toBeUndefined();
    expect(boxBounds(layer.group.getObjectByName("coin_cargo_chests")!)).toHaveLength(6);
    layer.dispose();
  });

  it.each([true, false])("keeps four full-size barge chests supported and clear of the rower (detailed=%s)", detailed => {
    const assets = createSmallBoatCoinCargo(detailed), material = new MeshStandardMaterial(), cargo = assets.create(material);
    const manifest: CargoBox[] = Array.from({ length: 4 }, () => ({ count: 250, ware: "coins" }));
    expect(cargo.update(manifest)).toBe(true);
    const boxes = boxBounds(cargo.root.getObjectByName("coin_cargo_chests")!);
    expect(boxes).toHaveLength(4);
    for (const box of boxes) {
      expect(box.min.y).toBeGreaterThanOrEqual(.12 - 1e-6);
      expect(box.min.z).toBeGreaterThan(-.25);
      expect(box.max.z).toBeLessThan(.62);
      expect(Math.max(Math.abs(box.min.x), Math.abs(box.max.x))).toBeLessThan(.31);
    }
    expect(boxes[2]!.min.y).toBeCloseTo(boxes[0]!.max.y, 6);
    expect(boxes[3]!.min.y).toBeCloseTo(boxes[1]!.max.y, 6);
    expect(cargo.update([])).toBe(false); expect(cargo.root.visible).toBe(false);
    cargo.dispose(); assets.dispose(); material.dispose();
  });

  it("releases instance buffers independently and disposes the shared source exactly once", () => {
    const assets = createCoinChestInstances(false), first = assets.create(2), second = assets.create(2);
    first.update([{ x: 0, y: 0, z: 0 }]); second.update([{ x: 1, y: 0, z: 0 }]);
    const a = first.root.children[0] as InstancedMesh, b = second.root.children[0] as InstancedMesh;
    expect(a.geometry).toBe(b.geometry);
    const disposal = vi.spyOn(a.geometry, "dispose"), instance = vi.spyOn(a, "dispose");
    first.dispose(); first.dispose(); expect(instance).toHaveBeenCalledOnce(); expect(disposal).not.toHaveBeenCalled();
    second.update([{ x: 3, y: 0, z: 0 }]); expect(b.count).toBe(1);
    second.dispose(); assets.dispose(); assets.dispose(); expect(disposal).toHaveBeenCalledOnce();
  });
});
