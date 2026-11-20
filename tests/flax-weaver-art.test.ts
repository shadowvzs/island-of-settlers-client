import { readFileSync } from "node:fs";
import { Raycaster, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { getRomanBuildingGridMetrics } from "../src/render-common/buildings/building-grid-metrics";
import type { BuildingPart, Point3 } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds, getRomanRecipeBounds } from "../src/render-common/buildings/building-recipe-fit";
import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { recipeHeight } from "../src/render-common/buildings/levels/level-site";
import {
  buildingLevelAdditions, leveledBuildingRecipe
} from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createFlaxDryingData, createFlaxStubbleData, createWheatMeshData } from "../src/render-common/wheat-field";
import { WORKER_HEIGHT, WORKER_RADIUS } from "../src/render-common/workers/worker-dimensions";
import { getJobAction, getWorkerHeldProp } from "../src/render-common/workers/worker-job-actions";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import { createNationBuilding } from "../src/renderers/three/buildings/nation-building";
import { flaxFieldVisibility } from "../src/renderers/three/settlement/three-wheat-field";
import { createPlainBuildingMaterials, stubPaintCanvas } from "./helpers/building-materials";
import { unsupportedParts } from "./helpers/recipe-supports";

const NATIONS = ["roman", "viking", "nubian", "japanese"] as const;
const TYPES = [60, 61] as const;
const DETAILS = [true, false] as const;
const LEVELS = [1, 2, 3, 4, 5] as const;
const definitionOf = (type: number) => BUILDING_CATALOG.find(entry => entry.id === type)!;
const stockOf = (parts: readonly BuildingPart[]) => parts.filter(part => part.stock);
const DOOR_CORRIDOR = (door: Point3, width: number) => ({
  max: [door[0] + width / 2 + .08, .82, door[2] + .95] as Point3,
  min: [door[0] - width / 2 - .08, .025, door[2] + .19] as Point3
});
const blocks = (part: BuildingPart, corridor: ReturnType<typeof DOOR_CORRIDOR>) => {
  const { max, min } = getRomanPartBounds(part);
  return [0, 1, 2].every(axis => min[axis]! < corridor.max[axis]! && max[axis]! > corridor.min[axis]!);
};

describe("national Flax Farm and Weaver models", () => {
  it.each(TYPES)("type %i keeps its Small plot and canonical anchors", type => {
    const definition = definitionOf(type);
    const sizing = getRomanBuildingWorldSizing(definition);
    expect(sizing.cells).toEqual(type === 60 ? [3, 3] : [4, 4]);
    for (const nation of NATIONS) for (const detailed of DETAILS) {
      const recipe = leveledBuildingRecipe(definition, nation, detailed, 1);
      expect(recipe.door[2]).toBeCloseTo(type === 60 ? .416 : .566, 6);
      expect(recipe.workerExit).toEqual([0, 0, type === 60 ? 1.35 : 1.5]);
      expect(recipe.workPoint[0]).toBeCloseTo(type === 60 ? .495 : .675, 6);
      expect(recipe.workPoint[1]).toBe(0);
      expect(recipe.workPoint[2]).toBeCloseTo(type === 60 ? .9 : 1.05, 6);
      expect(recipe.doorDimensions?.width).toBeCloseTo(.46, 6);
    }
  });

  it.each(TYPES.flatMap(type => NATIONS.flatMap(nation => DETAILS.map(detailed =>
    ({ detailed, nation, type })))))(
    "type $type $nation (detail: $detailed) has supported, bounded level art", ({ detailed, nation, type }) => {
      const definition = definitionOf(type), base = leveledBuildingRecipe(definition, nation, detailed, 1);
      const baseBounds = getRomanRecipeBounds(definition, base), heightCap = recipeHeight(base.parts) * 1.3;
      expect(unsupportedParts(base)).toEqual([]);
      for (const level of LEVELS) {
        const recipe = leveledBuildingRecipe(definition, nation, detailed, level);
        expect(unsupportedParts(recipe), `level ${level}`).toEqual([]);
        const bounds = getRomanRecipeBounds(definition, recipe);
        expect(bounds.extentX).toBeLessThanOrEqual(baseBounds.extentX + 1e-3);
        expect(bounds.extentZ).toBeLessThanOrEqual(baseBounds.extentZ + 1e-3);
        expect(recipeHeight(recipe.parts)).toBeLessThanOrEqual(heightCap + 1e-6);
        for (const key of ["door", "doorDimensions", "workerExit", "workPoint", "mechanism"] as const)
          expect(recipe[key]).toEqual(base[key]);
        expect(stockOf(recipe.parts)).toEqual(stockOf(base.parts));
        if (level > 1) expect(buildingLevelAdditions(definition, nation, detailed, level).length)
          .toBeGreaterThan(buildingLevelAdditions(definition, nation, detailed, level - 1 as 1).length);
      }
      const corridor = DOOR_CORRIDOR(base.door, base.doorDimensions!.width);
      for (const level of [2, 3, 4, 5] as const)
        expect(buildingLevelAdditions(definition, nation, detailed, level)
          .filter(part => blocks(part, corridor))).toEqual([]);
    });

  it.each(TYPES)("type %i exposes the complete canonical stock set", type => {
    const definition = definitionOf(type);
    for (const nation of NATIONS) for (const detailed of DETAILS) {
      const recipe = leveledBuildingRecipe(definition, nation, detailed, 1);
      const inputs = stockOf(recipe.parts).filter(part => part.stock?.kind === "input");
      const outputs = stockOf(recipe.parts).filter(part => (part.stock?.kind ?? "output") === "output");
      expect(inputs.map(part => part.stock!.ware)).toEqual(type === 61 ? ["flax"] : []);
      expect(outputs).toHaveLength(6);
      expect(outputs.every(part => part.stock!.ware === (type === 60 ? "flax" : "cloth"))).toBe(true);
      expect(outputs.map(part => part.stock!.slot).sort((a, b) => a! - b!)).toEqual([0, 1, 2, 3, 4, 5]);
    }
  });


  it.each(TYPES.flatMap(type => NATIONS.flatMap(nation => DETAILS.map(detailed =>
    ({ detailed, nation, type })))))(
    "type $type $nation (detail: $detailed) clears the real worker doorway in all rotations",
    ({ detailed, nation, type }) => {
      stubPaintCanvas();
      const definition = definitionOf(type), materials = createPlainBuildingMaterials();
      const model = createNationBuilding(definition, materials, nation, detailed);
      const { scale } = getRomanBuildingGridMetrics(definition), dimensions = model.recipe.doorDimensions!;
      model.root.scale.setScalar(scale);
      model.update(0, { construction: 1, door: 1, working: false });
      const center = model.recipe.door[0] + dimensions.width / 2;
      for (let turn = 0; turn < 4; turn++) {
        const yaw = turn * Math.PI / 2;
        model.root.rotation.y = yaw;
        model.root.updateMatrixWorld(true);
        const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        for (const lateral of [-WORKER_RADIUS, 0, WORKER_RADIUS])
          for (const height of [.04 * scale + .01, WORKER_HEIGHT / 2, WORKER_HEIGHT + .0125]) {
            const point = new Vector3(center * scale + lateral, height, model.recipe.door[2] * scale)
              .applyAxisAngle(new Vector3(0, 1, 0), yaw);
            const ray = new Raycaster(point.addScaledVector(forward, .15), forward.clone().negate(), 0, .3);
            expect(ray.intersectObject(model.root, true), `${nation}/${type}/${detailed}/turn ${turn}/x ${lateral}/y ${height}`)
              .toHaveLength(0);
          }
      }
      model.dispose();
    });

  it.each(TYPES)("type %i exposes reachable canonical stock contacts", type => {
    const outputWare = type === 60 ? "flax" : "cloth";
    for (let slot = 0; slot < 6; slot++) {
      const contact = getBuildingStockContact(type, "output", outputWare, slot, 0, 0, 0);
      expect(contact, `${type}/${outputWare}/${slot}`).not.toBeNull();
      expect(contact!.approach.every(Number.isFinite)).toBe(true);
    }
    if (type === 61) {
      const input = getBuildingStockContact(type, "input", "flax", 0, 0, 0, 0);
      expect(input).not.toBeNull();
      expect(input!.approach[2]).toBeGreaterThan(input!.stock[2]);
    }
  });

  it.each(TYPES)("type %i gets a distinct national silhouette, not one recoloured shell", type => {
    const definition = definitionOf(type), signatures = new Set<string>();
    for (const nation of NATIONS) {
      const recipe = leveledBuildingRecipe(definition, nation, true, 1);
      signatures.add(JSON.stringify(recipe.parts.filter(part => !part.stock).map(part =>
        [part.shape, part.position.map(value => Math.round(value * 1000)), part.size.map(value => Math.round(value * 1000))])));
      expect(recipe.parts.length).toBeGreaterThan(60);
    }
    expect(signatures.size).toBe(NATIONS.length);
    expect(leveledBuildingRecipe(definition, "nubian", true, 1).parts.some(part =>
      part.surface === "nubian-textile")).toBe(true);
  });
});

describe("flax and weaver worker presentation", () => {
  it("maps the grower and weaver work to their dedicated clips", () => {
    expect(getJobAction("Flax grower", "work", null, "harvest")).toBe("harvest_flax");
    expect(getJobAction("Flax grower", "work", null, "sow")).toBe("idle_breathe");
    expect(getJobAction("Weaver", "work")).toBe("weave_loom");
    expect(getJobAction("Flax grower", "walk")).toBe("walk");
    expect(getJobAction("Weaver", "walk")).toBe("walk");
    expect(getJobAction("Farmer", "work", null, "harvest")).toBe("harvest_wheat");
    expect(getJobAction("Beekeeper", "work", null, "harvest")).toBe("lift_honeycomb");
  });

  it("holds the flax bundle and weaver shuttle from the worker pack", () => {
    expect(getWorkerHeldProp({ action: "harvest_flax" } as WorkerFrame))
      .toEqual({ id: "flax_bundle", source: "pack" });
    expect(getWorkerHeldProp({ action: "weave_loom" } as WorkerFrame))
      .toEqual({ id: "weaver_shuttle", source: "pack" });
    expect(getWorkerHeldProp({ action: "harvest_flax", carryingWare: "flax" } as WorkerFrame))
      .toEqual({ id: "flax_bundle", source: "pack" });
  });

  it("exports both clips and their held props into the worker manifests", () => {
    const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
    const pack = read("../../island-of-settlers-worker-generation/game_ready/threejs/manifest.json");
    const tripo = read("../../island-of-settlers-worker-generation/game_ready/tripo/manifest.json");
    for (const manifest of [pack, tripo]) {
      const clips = new Map<string, { prop?: string }>(manifest.clips.map((clip: { name: string }) =>
        [clip.name, clip]));
      expect(clips.get("harvest_flax")?.prop).toBe("flax_bundle");
      expect(clips.get("weave_loom")?.prop).toBe("weaver_shuttle");
    }
    expect(pack.props.flax_bundle).toContain("prop-flax_bundle");
    expect(pack.props.weaver_shuttle).toContain("prop-weaver_shuttle");
    expect(tripo.props.flax_bundle).toContain("flax_bundle");
    expect(tripo.props.weaver_shuttle).toContain("weaver_shuttle");
  });

  it("selects standing crop, drying stooks and stubble by field state", () => {
    expect(flaxFieldVisibility("growing")).toEqual({ drying: false, plants: true, stubble: false });
    expect(flaxFieldVisibility("ripe")).toEqual({ drying: false, plants: true, stubble: false });
    expect(flaxFieldVisibility("drying")).toEqual({ drying: true, plants: false, stubble: false });
    expect(flaxFieldVisibility("stubble")).toEqual({ drying: false, plants: false, stubble: true });
    for (const detailed of DETAILS) {
      const stubble = createFlaxStubbleData(11, detailed);
      const drying = createFlaxDryingData(11, detailed);
      expect(stubble.positions.length).toBeGreaterThan(0);
      expect(drying.positions.length).toBeGreaterThan(0);
      expect(stubble.positions.length % 9).toBe(0);
      expect(drying.positions.length % 9).toBe(0);
      expect(stubble.colors).toHaveLength(stubble.positions.length);
      expect(drying.normals).toHaveLength(drying.positions.length);
    }
    const highFlax = createWheatMeshData(7, true, "flax"), highWheat = createWheatMeshData(7, true, "wheat");
    expect(highFlax.positions.length).not.toBe(highWheat.positions.length);
    expect(highFlax.positions.length / 9).toBeGreaterThan(800);
  });
});
