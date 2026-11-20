import { Box3, Mesh, type MeshStandardMaterial } from "three";
import { expect, it } from "vitest";

import { DEFAULT_ROMAN_DOOR } from "../src/render-common/buildings/roman-door-profile";
import { japanesePlankDetail, japaneseTimberDetail } from "../src/renderers/three/buildings/cultural-timber-surface-detail";
import { createRomanGroundDoor, createWoodenDoorPanel } from "../src/renderers/three/buildings/roman-door";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it.each([true, false])("keeps longitudinal board grain and recessed seams in the shared leaf (%s)", detailed => {
  const materials = createPlainBuildingMaterials();
  const root = createRomanGroundDoor(materials, detailed, [0, 0, 0], false);
  try {
    const panel = root.getObjectByName("door_panel") as Mesh;
    expect(panel.material).toBe(detailed ? materials.wood : materials.planks);
    const geometry = panel.geometry, positions = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv"), colours = geometry.getAttribute("color");
    const bounds = new Box3().setFromObject(panel);
    expect(bounds.min.x).toBeCloseTo(0, 6);
    expect(bounds.max.x).toBeCloseTo(DEFAULT_ROMAN_DOOR.width, 6);
    expect(bounds.min.z).toBeCloseTo(-.03, 6);
    expect(bounds.max.z).toBeCloseTo(detailed ? .0435 : .03, 6);
    if (!detailed) {
      expect(positions.count / 3).toBe(12);
      expect(Math.min(...Array.from(uv.array).filter((_, index) => index % 2 === 0))).toBeCloseTo(0, 6);
      expect(Math.max(...Array.from(uv.array).filter((_, index) => index % 2 === 0))).toBeCloseTo(1, 6);
      return;
    }
    const boards = new Map<number, number[]>();
    for (let index = 0; index < positions.count; index++) {
      if (colours.getX(index) < .9) continue;
      const x = positions.getX(index), u = uv.getX(index);
      const board = Math.min(5, Math.floor(x / DEFAULT_ROMAN_DOOR.width * 6));
      const samples = boards.get(board) ?? [];
      samples.push(u); boards.set(board, samples);
    }
    expect(boards.size).toBe(6);
    for (const samples of boards.values()) {
      // A full grain crop across EACH board prevents one huge knot spanning the whole door.
      expect(Math.max(...samples) - Math.min(...samples)).toBeCloseTo(.9, 4);
    }
    expect(Math.min(...Array.from(colours.array))).toBeCloseTo(.72, 5);
    expect(root.children.length).toBe(detailed ? 3 : 1);
  } finally {
    root.traverse(object => { if (object instanceof Mesh) object.geometry.dispose(); });
    Object.values(materials).forEach((material: MeshStandardMaterial) => material.dispose());
  }
});

it("keeps the balcony panel's original box envelope and uses no private texture/material", () => {
  const geometry = createWoodenDoorPanel(false, false,
    { height: .5, spring: .5, width: .35 }, .035, .0175);
  try {
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    expect(bounds.min.toArray()).toEqual([0, 0, expect.closeTo(-.0175, 6)]);
    expect(bounds.max.toArray()).toEqual([expect.closeTo(.35, 6), .5, expect.closeTo(.0175, 6)]);
  } finally { geometry.dispose(); }
});

it.each([true, false])("retains the authored arch crown and a finite UV frame on every face (%s)", detailed => {
  const geometry = createWoodenDoorPanel(true, detailed);
  try {
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.max.y).toBeCloseTo(
      DEFAULT_ROMAN_DOOR.spring + DEFAULT_ROMAN_DOOR.width / 2, 6);
    expect(Array.from(geometry.getAttribute("uv").array).every(Number.isFinite)).toBe(true);
    expect(Array.from(geometry.getAttribute("normal").array).every(Number.isFinite)).toBe(true);
  } finally { geometry.dispose(); }
});

it("bakes recessed cedar-board seams without changing the ordinary Japanese timber surface", () => {
  const point = { grain: .5, mineral: .5, u: 1 / 6, v: .5, weather: .5 };
  const seam = japanesePlankDetail(point), timber = japaneseTimberDetail(point);
  const facePoint = { ...point, u: 1 / 4 }, face = japanesePlankDetail(facePoint);
  expect(seam.brightness).toBeLessThan(timber.brightness - .2);
  expect(seam.height).toBeLessThan(timber.height - .2);
  expect(face.height).toBe(japaneseTimberDetail(facePoint).height);
  expect(face.colour).toEqual(timber.colour);
});
