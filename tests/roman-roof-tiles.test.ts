import { Euler, Matrix4, Vector3 } from "three";
import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart, Point3 } from "../src/render-common/buildings/building-recipe";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import type { RomanDesignContext } from "../src/render-common/buildings/roman-design-kit";
import { addRomanRoofTiles } from "../src/render-common/buildings/roman-roof-tiles";
import { createRomanRoofTile } from "../src/renderers/three/buildings/roman-roof-tile";
import { sampleRomanSurfaceDetail } from "../src/renderers/three/buildings/roman-surface-detail";

it.each([-0.54, 0.54])("keeps aligned, overlapping pottery channels in contact with pitch %s", pitch => {
  const plane: BuildingPart = { shape: "box", surface: "roof", stage: 4,
    position: [0.4, 1.8, -0.2], size: [0.94, 0.065, 1.12], rotation: [0, 0.5, pitch] };
  const parts = [plane];
  const part: RomanDesignContext["part"] = (surface, position, size, stage, shape, rotation, tint) => {
    parts.push({ surface, position, size, stage: stage ?? 2, shape: shape ?? "box", rotation, tint });
  };
  addRomanRoofTiles({ parts, part, detailed: true, roof: () => {} });
  const tiles = parts.slice(1);
  const rows = Math.ceil(plane.size[0] / (0.3 * 0.65 * 0.6)), columns = Math.ceil(plane.size[2] / (0.22 * 0.65));
  expect(tiles).toHaveLength(rows * columns);
  const inverse = new Matrix4().makeRotationFromEuler(new Euler(...plane.rotation!, "ZYX")).invert();
  const local = tiles.map(tile => new Vector3(...tile.position)
    .sub(new Vector3(...plane.position)).applyMatrix4(inverse));
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const index = row * columns + column;
    expect(local[index]!.z).toBeCloseTo(local[column]!.z);
    expect(local[index]!.y).toBeCloseTo(plane.size[1] / 2 - 0.0005);
    // Buried underside gives every tile real support from the retained roof plane.
    expect(local[index]!.y - tiles[index]!.size[1] * 0.12).toBeLessThan(plane.size[1] / 2);
    expect(tiles[index]!.size[0]).toBeGreaterThan(plane.size[0] / rows);
    expect(tiles[index]!.size[2]).toBeGreaterThanOrEqual(plane.size[2] / columns);
    const rotation = tiles[index]!.rotation as Point3;
    expect(rotation[2]).toBe(pitch);
    expect(rotation[1]).toBeCloseTo(plane.rotation![1] + (pitch > 0 ? Math.PI : 0));
  }
});

it("adds smooth rounded pottery within the 8 visible triangles per short tile", () => {
  const geometry = createRomanRoofTile();
  const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
  expect(positions.count / 3).toBe(8);
  geometry.computeBoundingBox();
  expect(geometry.boundingBox!.min.y).toBeCloseTo(0);
  expect(geometry.boundingBox!.max.y).toBeLessThan(0.52);
  for (let index = 0; index < normals.count; index++) {
    const normal = new Vector3().fromBufferAttribute(normals, index);
    expect(normal.length()).toBeCloseTo(1, 6);
  }
  // Smooth crowns share vertex normals across adjacent strips instead of flat plank facets.
  expect(new Vector3().fromBufferAttribute(normals, 2)
    .distanceTo(new Vector3().fromBufferAttribute(normals, 7))).toBeLessThan(1e-6);
  geometry.dispose();
});

it("keeps the roof-facing normal on both ordinary and rotated cottage roof planes", () => {
  for (const definition of BUILDING_CATALOG) {
    const recipe = createRomanBuildingRecipe(definition, true);
    const planes = recipe.parts.filter(part => part.surface.startsWith("roof") && part.shape === "box" &&
      part.stage === 4 && part.size[1] < 0.1);
    for (const tile of recipe.parts.filter(part => part.shape === "tile")) {
      const normal = new Vector3(0, 1, 0).applyEuler(new Euler(...tile.rotation!, "ZYX"));
      expect(planes.some(plane => normal.distanceTo(new Vector3(0, 1, 0)
        .applyEuler(new Euler(...(plane.rotation ?? [0, 0, 0]), "ZYX"))) < 1e-6)).toBe(true);
    }
  }
});

it("keeps Minimal clay channels aligned between rows with restrained earthy color variation", () => {
  const point = { grain: 0.5, mineral: 0.5, u: 0.031, v: 0.041, weather: 0.5 };
  const first = sampleRomanSurfaceDetail("roof", point, false);
  const second = sampleRomanSurfaceDetail("roof", { ...point, v: point.v + 0.65 * 0.6 / 12 }, false);
  expect(first.height).toBeCloseTo(second.height);
  const dry = sampleRomanSurfaceDetail("roof", { ...point, weather: 0 }, true);
  const worn = sampleRomanSurfaceDetail("roof", { ...point, weather: 1 }, true);
  expect(worn.brightness - dry.brightness).toBeLessThanOrEqual(0.160001);
});

it("reduces clay width, overlap and height together while preserving the supported roof plane", () => {
  const plane: BuildingPart = { shape: "box", surface: "roof", stage: 4,
    position: [0, 1, 0], size: [3, .065, 2.2] };
  const parts = [plane];
  const part: RomanDesignContext["part"] = (surface, position, size, stage, shape, rotation, tint) => {
    parts.push({ surface, position, size, stage: stage ?? 2, shape: shape ?? "box", rotation, tint });
  };
  addRomanRoofTiles({ parts, part, detailed: true, roof: () => {} });
  expect(parts[0]).toBe(plane);
  const tiles = parts.slice(1);
  expect(tiles.length).toBeGreaterThan(100 * 2);
  expect(tiles.every(tile => tile.size[0] < .3 * .65 * .6 + .035 * .65 * .6 + 1e-6)).toBe(true);
  expect(tiles.every(tile => tile.size[2] < .22 * .65 + .002 * .65 + 1e-6)).toBe(true);
  expect(tiles.every(tile => tile.size[1] === .085 * .65)).toBe(true);
});

it("puts the exposed cap on the downhill end so adjacent pottery courses remain visible", () => {
  const geometry = createRomanRoofTile();
  const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
  for (let index = 18; index < positions.count; index++) {
    expect(positions.getX(index)).toBe(.5);
    expect(normals.getX(index)).toBe(1);
  }
  for (const definition of BUILDING_CATALOG) {
    const recipe = createRomanBuildingRecipe(definition, true);
    for (const tile of recipe.parts.filter(part => part.shape === "tile")) {
      const downhill = new Vector3(1, 0, 0).applyEuler(new Euler(...tile.rotation!, "ZYX"));
      expect(downhill.y).toBeLessThanOrEqual(1e-6);
    }
  }
  geometry.dispose();
});
