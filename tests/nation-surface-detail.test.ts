import { BoxGeometry } from "three";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { applyBuildingWorldUv } from "../src/renderers/three/buildings/building-world-uv";
import {
  earthenRoofDetail, kawaraDetail, vikingShingleDetail
} from "../src/renderers/three/buildings/nation-roof-surface-detail";
import type { SurfaceSampler } from "../src/renderers/three/buildings/surface-detail-common";
import { limePlasterDetail, mudBrickDetail, plankDetail } from "../src/renderers/three/buildings/wall-surface-detail";

const point = { grain: .5, mineral: .5, u: .37, v: .32, weather: .5 };
const samplers: Record<string, SurfaceSampler> = {
  earthenRoofDetail, kawaraDetail, limePlasterDetail, mudBrickDetail, plankDetail, vikingShingleDetail
};

describe("nation wall and roof surfaces", () => {
  it.each(Object.entries(samplers))("%s tiles seamlessly and stays in usable PBR ranges", (_name, sample) => {
    for (let coordinate = 0; coordinate < 1; coordinate += .043) {
      const edges = [[{ u: coordinate, v: 0 }, { u: coordinate, v: 1 }], [{ u: 0, v: coordinate }, { u: 1, v: coordinate }]];
      for (const [a, b] of edges) {
        expect(sample({ ...point, ...a }).height).toBeCloseTo(sample({ ...point, ...b }).height, 6);
        expect(sample({ ...point, ...a }).brightness).toBeCloseTo(sample({ ...point, ...b }).brightness, 6);
      }
      const detail = sample({ ...point, u: coordinate, v: 1 - coordinate, weather: coordinate });
      expect(detail.brightness).toBeGreaterThan(.3);
      expect(detail.brightness).toBeLessThan(1.4);
      expect(detail.roughness).toBeGreaterThan(120);
      expect(detail.roughness).toBeLessThanOrEqual(255);
    }
  });

  it("recesses mud-brick mortar below the brick faces", () => {
    const mortar = mudBrickDetail({ ...point, u: .5, v: 0 });
    const brick = mudBrickDetail({ ...point, u: .1, v: 1 / 24 });
    expect(brick.height - mortar.height).toBeGreaterThan(.2);
  });

  it("opens dark notches between rounded shingle butts at the course edge", () => {
    // Canvas v is flipped: v = .9 lies in the butt end of a shingle row, below its rounded corners.
    const across = Array.from({ length: 240 }, (_, index) => vikingShingleDetail({ ...point, u: index / 240, v: .9 }));
    const brightness = across.map(detail => detail.brightness), height = across.map(detail => detail.height);
    expect(Math.max(...brightness) - Math.min(...brightness)).toBeGreaterThan(.2);
    expect(Math.max(...height) - Math.min(...height)).toBeGreaterThan(.3);
  });
});

describe("recipe-unit texture mapping", () => {
  it("keeps one texture scale on boxes of any size and lines unrotated parts up on a shared grid", () => {
    const small = new BoxGeometry(1, 1, 1).scale(.5, 1, .2), large = new BoxGeometry(1, 1, 1).scale(2, 1, .2);
    applyBuildingWorldUv(small, 1, [1, 0, 0]);
    applyBuildingWorldUv(large, 1);
    const span = (geometry: BoxGeometry) => {
      const uv = geometry.getAttribute("uv"), us = Array.from({ length: 4 }, (_, index) => uv.getX(16 + index));
      return Math.max(...us) - Math.min(...us);
    };
    // Face 4 (+z) maps x: half a unit wide on the small box, two units on the large one.
    expect(span(small)).toBeCloseTo(.5);
    expect(span(large)).toBeCloseTo(2);
    expect(small.getAttribute("uv").getX(16)).toBeCloseTo(.75);
  });

  it("maps nation and Roman walls in recipe units", () => {
    const definition = getBuildingDefinition(23);
    const romanWalls = createNationBuildingRecipe(definition, "roman").parts.filter(part => part.shape === "box" &&
      !part.stock && part.surface === "stone" && part.size[1] > .5);
    expect(romanWalls.length).toBeGreaterThan(0);
    expect(romanWalls.every(part => part.worldUv === .875)).toBe(true);
    // The rollback / sizing baseline stays free of texture hints.
    expect(createRomanBuildingRecipe(definition, true, false).parts.some(part => part.worldUv)).toBe(false);
    for (const nation of ["viking", "nubian", "japanese"] as const) {
      const parts = createNationBuildingRecipe(definition, nation).parts;
      const walls = parts.filter(part => part.shape === "box" && !part.stock &&
        ["plaster", "planks"].includes(part.surface));
      expect(walls.length).toBeGreaterThan(0);
      expect(walls.every(part => part.worldUv)).toBe(true);
    }
  });

  it("lays stepped shingle courses on High Viking roofs only", () => {
    const definition = getBuildingDefinition(3);
    const courses = (detailed: boolean) => createNationBuildingRecipe(definition, "viking", detailed).parts
      .filter(part => part.surface === "roof" && part.shape === "box" && part.size[1] < .05).length;
    expect(courses(true)).toBeGreaterThanOrEqual(6);
    expect(courses(false)).toBe(0);
  });
});
