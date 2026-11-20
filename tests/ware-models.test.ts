import { STARTER_STOCK } from "@shared/catalog/balance";
import { readFileSync } from "node:fs";
import { Box3, Mesh, MeshStandardMaterial } from "three";
import { expect, it } from "vitest";

import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { srgbToLinear } from "../src/render-common/color";
import { woodWareAppearance } from "../src/render-common/wares/advanced-material-variants";
import {
  getWareCarryAction,
  resolveWareId,
  WARE_IDS
} from "../src/render-common/wares/ware-catalog";
import { createWareRecipe } from "../src/render-common/wares/ware-recipe";
import { getJobAction, getWorkerHeldProp } from "../src/render-common/workers/worker-job-actions";
import { createWareModel } from "../src/renderers/three/settlement/ware-models";
import { PRODUCTION_RULES } from "../src/shared/settlement/production-rules";

const material = new MeshStandardMaterial();
const surfaces = new Set(
  WARE_IDS.flatMap((id) => createWareRecipe(id, true).parts.map((part) => part.surface))
);
const materials = Object.fromEntries([...surfaces].map((surface) => [surface, material])) as Record<
  BuildingSurface,
  MeshStandardMaterial
>;

it("covers every carried production ware, construction supply and job tool", () => {
  const goods = new Set(Object.keys(STARTER_STOCK));
  for (const rule of Object.values(PRODUCTION_RULES)) {
    for (const ware of [...rule.inputs, ...(rule.animal ? [] : rule.outputs)]) goods.add(ware);
    if (rule.tool) goods.add(rule.tool);
  }
  for (const ware of goods) expect(resolveWareId(ware), ware).not.toBeNull();
  // Civilian horse breeding is retired; legacy horse stock still has no back-carried ware model.
  expect(PRODUCTION_RULES[38]).toBeUndefined();
  expect(resolveWareId("horse")).toBeNull();
  expect(resolveWareId("iron ore")).toBe("ironOre");
  expect(resolveWareId("boards")).toBe("planks");
  expect(getWareCarryAction("logs")).toBe("carry_shoulder");
  expect(getWareCarryAction("planks")).toBe("carry_shoulder");
  expect(getWareCarryAction("fish")).toBe("carry_back");
});

it.each(WARE_IDS)("%s remains an identifiable, finite standalone mesh on both LODs", (id) => {
  for (const detailed of [true, false]) {
    const model = createWareModel(id, detailed, materials, "carry");
    expect(model.root.userData.ware).toBe(id);
    expect(model.recipe.parts.length).toBeGreaterThan(0);
    expect(model.triangles()).toBeLessThan(detailed ? 3500 : 550);
    expect(model.triangles()).toBeGreaterThan(0);
    model.root.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(model.root);
    expect(bounds.min.toArray().every(Number.isFinite)).toBe(true);
    expect(bounds.max.toArray().every(Number.isFinite)).toBe(true);
    expect(bounds.max.x - bounds.min.x).toBeLessThan(1.1);
    if (id === "logs") expect(bounds.max.z - bounds.min.z).toBeCloseTo(.907 * 1.35, 6);
    else expect(bounds.max.z - bounds.min.z).toBeLessThan(1.1);
    model.root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      expect(object.geometry.getAttribute("uv")).toBeDefined();
      if (id === "pig") {
        expect(object.userData.sourceAsset).toBe("fabiotambone/lowpoly-pig");
        expect(object.geometry.getAttribute("skinWeight")).toBeDefined();
      } else if (woodWareAppearance(id)) {
        // Approved colony timber reuses measured source cargo with textured finishes, not vertex colours.
        expect(object.parent?.userData.sourceAsset).toBeDefined();
        expect((object.material as MeshStandardMaterial).map).toBeTruthy();
      } else expect(object.geometry.getAttribute("color")).toBeDefined();
    });
    let materialDisposed = false;
    const observe = () => {
      materialDisposed = true;
    };
    material.addEventListener("dispose", observe);
    model.dispose();
    expect(materialDisposed).toBe(false);
    material.removeEventListener("dispose", observe);
  }
});

it("keeps coal contents near-black in the linear vertex tint without changing ore or flour", () => {
  const expectedCoal = srgbToLinear(0.13, 0.135, 0.14);
  const coalRocks = createWareRecipe("coal", true).parts.filter((part) => part.shape === "rock");
  expect(coalRocks.length).toBeGreaterThan(0);
  for (const part of coalRocks) {
    expect(part.tint).toEqual(expectedCoal);
    for (const channel of part.tint!) expect(channel).toBeLessThan(0.02);
  }
  const oreRocks = createWareRecipe("ironOre", true).parts.filter((part) => part.shape === "rock");
  expect(oreRocks.length).toBeGreaterThan(0);
  for (const part of oreRocks) expect(part.tint).toEqual([0.43, 0.25, 0.16]);
  const flourBag = createWareRecipe("flour", true).parts.find((part) => part.shape === "sack");
  expect(flourBag?.tint).toEqual([0.43, 0.34, 0.22]);
});

it("uses distinct authored goods instead of assigning every ware a generic sack", () => {
  const log = createWareRecipe("logs", true).parts;
  expect(log[0]!.surface).toBe("bark");
  expect(log[0]!.shape).toBe("cylinder");
  // Main trunk ends retain growth rings; detailed LOD adds flush-cut branch collars.
  expect(log.slice(-2).map(part => part.surface)).toEqual(["endgrain", "endgrain"]);
  expect(log.filter(part => part.surface === "bark").length).toBeGreaterThan(1);
  const cheapLog = createWareRecipe("logs", false).parts;
  expect(cheapLog.map(part => part.surface)).toEqual(["bark", "endgrain", "endgrain"]);
  expect(createWareRecipe("coal", true).parts.some((part) => part.shape === "open-sack")).toBe(
    true
  );
  expect(createWareRecipe("ironOre", true).parts.some((part) => part.shape === "open-sack")).toBe(
    true
  );
  expect(createWareRecipe("goldOre", true).parts.some((part) => part.shape === "open-sack")).toBe(
    true
  );
  expect(createWareRecipe("fish", true).parts.some((part) => part.shape === "fish")).toBe(true);
  expect(createWareRecipe("iron", true).parts.some((part) => part.surface === "steel")).toBe(true);
  expect(createWareRecipe("coins", true).parts.some((part) => part.surface === "gold")).toBe(true);
});

it.each(["meat", "bread", "armor"])(
  "%s preserves authored part tint exactly once and leaves shared materials intact",
  (id) => {
    for (const detailed of [true, false]) {
      const model = createWareModel(id, detailed, materials);
      const meshes = model.root.children[0]!.children as Mesh[];
      model.recipe.parts.forEach((part, index) => {
        const colors = meshes[index]!.geometry.getAttribute("color");
        const tint = part.tint ?? [1, 1, 1];
        for (let vertex = 0; vertex < colors.count; vertex++) {
          expect(colors.getX(vertex)).toBeCloseTo(tint[0], 6);
          expect(colors.getY(vertex)).toBeCloseTo(tint[1], 6);
          expect(colors.getZ(vertex)).toBeCloseTo(tint[2], 6);
        }
        expect(meshes[index]!.material).toBe(materials[part.surface]);
      });
      let geometryDisposals = 0;
      for (const mesh of meshes)
        mesh.geometry.addEventListener("dispose", () => geometryDisposals++);
      const originalColor = material.color.clone();
      model.dispose();
      expect(geometryDisposals).toBe(meshes.length);
      expect(material.color.equals(originalColor)).toBe(true);
    }
  }
);

it("maps jobs to verified exported animation clips and their appropriate tools", () => {
  const manifest = JSON.parse(
    readFileSync("../island-of-settlers-worker-generation/game_ready/tripo/manifest.json", "utf8")
  );
  const names = new Set(manifest.clips.map((clip: { name: string }) => clip.name));
  for (const job of ["Builder", ...Object.values(PRODUCTION_RULES).map((rule) => rule.job)]) {
    for (const action of ["walk", "carry", "chop", "plant", "work", "idle"])
      expect(names.has(getJobAction(job, action, "logs")), `${job}/${action}`).toBe(true);
  }
  expect(getJobAction("Builder", "work")).toBe("build_hammer");
  expect(getWorkerHeldProp({ action: "build_hammer", workerJob: "Builder" })).toEqual({
    id: "hammer",
    source: "pack"
  });
  expect(getWorkerHeldProp({ action: "build_hammer", workerJob: "Stonemason" })).toEqual({
    id: "pickaxe",
    source: "tool"
  });
  expect(getWorkerHeldProp({ action: "build_hammer", workerJob: "Butcher" })).toEqual({
    id: "cleaver",
    source: "tool"
  });
  expect(getWorkerHeldProp({ action: "chop_tree", workerJob: "Woodcutter" })).toEqual({
    id: "axe",
    source: "pack"
  });
  expect(getJobAction("Soldier", "work")).toBe("idle_breathe");
  expect(getJobAction("Hunter", "work")).toBe("idle_breathe");
});
