import { BoxGeometry, type BufferGeometry } from "three";
import { expect, it } from "vitest";

import { BUILDING_CATALOG, getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart, BuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { isJapaneseInteriorFloor, withJapaneseInteriorFloors } from "../src/render-common/buildings/japanese-interior-floors";
import { type BuildingLevel } from "../src/render-common/buildings/levels/building-level";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { keepInteriorFloorFaces } from "../src/renderers/three/buildings/interior-floor-faces";
import { createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";

const levels: BuildingLevel[] = [1, 2, 3, 4, 5];

it("finishes actual room floors across every Japanese roster, level and detail level", () => {
  let roomFloors = 0;
  for (const detailed of [true, false]) for (const level of levels) for (const definition of BUILDING_CATALOG) {
    const recipe = leveledBuildingRecipe(definition, "japanese", detailed, level);
    for (const part of recipe.parts.filter(isJapaneseInteriorFloor)) {
      expect(part.surface, `${definition.id}/${level}/${detailed}`).toBe("planks");
      expect(part.worldUv, `${definition.id}/${level}/${detailed}`).toBe(1);
      roomFloors++;
    }
    expect(recipe.parts.some(part => part.surface === "mosaic" && part.stage === 0)).toBe(false);
  }
  expect(roomFloors).toBeGreaterThan(400);
});

it("includes the Lodge early return and room-scale boards on every bamboo Forester", () => {
  for (const detailed of [true, false]) for (const id of [20, 41, 45, 49, 53, 62]) {
    const recipe = createNationBuildingRecipe(getBuildingDefinition(id), "japanese", detailed);
    const floors = recipe.parts.filter(isJapaneseInteriorFloor);
    expect(floors.length, `${id}/${detailed}`).toBeGreaterThan(0);
    expect(floors.every(part => part.surface === "planks" && part.worldUv === 1)).toBe(true);
  }
});

it("preserves exact anchors, stock, nonfloor parts and floor envelope without another overlay", () => {
  const floor: BuildingPart = { position: [0, .012, 0], shape: "box", size: [1.1, .024, .8],
    stage: 0, surface: "mosaic" };
  const stock: BuildingPart = { ...floor, stock: { slot: 0, ware: "planks", kind: "input" } };
  const bench: BuildingPart = { ...floor, stage: 3, surface: "wood", workyardAssembly: "fixture" };
  const roof: BuildingPart = { ...floor, rotation: [.2, 0, 0], stage: 4, surface: "planks" };
  const original: BuildingRecipe = { door: [0, 0, 1], doorProfile: "flat", mechanism: [0, 1, 0],
    workerExit: [0, 0, 1.5], workPoint: [1, 0, 0], parts: [floor, stock, bench, roof] };
  const finished = withJapaneseInteriorFloors(original, 62);
  expect(finished.parts).toHaveLength(original.parts.length);
  expect(finished.parts[0]).toEqual({ ...floor, surface: "planks", worldUv: 1 });
  expect(finished.parts.slice(1)).toEqual([stock, bench, roof]);
  const { parts: _before, ...beforeAnchors } = original;
  const { parts: _after, ...afterAnchors } = finished;
  expect(afterAnchors).toEqual(beforeAnchors);
  expect(finished.parts[1]).toBe(stock);
  expect(withJapaneseInteriorFloors(finished, 62)).toEqual(finished);
});

it("partitions a structural box into two board-top and ten stone-side triangles exactly", () => {
  const original = new BoxGeometry(1, 1, 1);
  const top = keepInteriorFloorFaces(original.clone(), "top");
  const sides = keepInteriorFloorFaces(original.clone(), "sides");
  try {
    expect(top.index!.count / 3).toBe(2);
    expect(sides.index!.count / 3).toBe(10);
    for (const vertex of top.index!.array) expect(top.getAttribute("normal").getY(vertex)).toBe(1);
    expect(top.getAttribute("position").count + sides.getAttribute("position").count)
      .toBe(original.getAttribute("position").count);
    const triangleVertices = (geometry: BufferGeometry) => Array.from(geometry.index!.array).map(vertex =>
      ["position", "normal", "uv"].flatMap(name => {
        const attribute = geometry.getAttribute(name);
        return Array.from({ length: attribute.itemSize }, (_, component) => attribute.getComponent(vertex, component));
      }).join(","));
    expect([...triangleVertices(top), ...triangleVertices(sides)].sort())
      .toEqual(triangleVertices(original).sort());
  } finally { original.dispose(); top.dispose(); sides.dispose(); }
});

it("keeps military lower-storey stone sides and exact supported board tops in both LODs", () => {
  for (const detailed of [true, false]) for (const id of [4, 9, 16]) {
    const recipe = createNationBuildingRecipe(getBuildingDefinition(id), "japanese", detailed);
    const tops = recipe.parts.filter(part => part.interiorFloorFaces === "top");
    const sides = recipe.parts.filter(part => part.interiorFloorFaces === "sides");
    expect(tops.length, `${id}/${detailed}`).toBeGreaterThan(0);
    expect(sides).toHaveLength(tops.length);
    for (const [index, part] of tops.entries()) {
      expect(part.surface).toBe("planks");
      const side = sides[index]!;
      expect(side.surface).toBe("stone");
      expect(side.position).toEqual(part.position);
      expect(side.size).toEqual(part.size);
      const geometry = createRomanPartGeometry(part, detailed), sideGeometry = createRomanPartGeometry(side, detailed);
      const unsplit = createRomanPartGeometry({ ...side, interiorFloorFaces: undefined }, detailed);
      try {
        expect(geometry.index!.count + sideGeometry.index!.count).toBe(unsplit.index!.count);
        const vertices = geometry.getAttribute("position");
        for (const at of geometry.index!.array) expect(vertices.getY(at)).toBeCloseTo(.12, 6);
      } finally { geometry.dispose(); sideGeometry.dispose(); unsplit.dispose(); }
    }
    expect(withJapaneseInteriorFloors(recipe, id)).toEqual(recipe);
  }
});

it("leaves other national floor palettes and open well/Monument geometry alone", () => {
  for (const nation of ["roman", "nubian", "viking", "maya", "indigenous"] as const) {
    for (const id of [4, 9, 16, 62]) {
      const recipe = createNationBuildingRecipe(getBuildingDefinition(id), nation, false);
      expect(recipe.parts.some(part => part.interiorFloorFaces)).toBe(false);
    }
  }
  for (const id of [7, 35]) {
    const recipe = createNationBuildingRecipe(getBuildingDefinition(id), "japanese", false);
    expect(withJapaneseInteriorFloors(recipe, id)).toEqual(recipe);
  }
});
