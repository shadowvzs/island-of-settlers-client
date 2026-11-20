import { Mesh, MeshStandardMaterial, Texture } from "three";
import { describe, expect, it, vi } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { ownBuildingMaterial, shareBuildingMaterialOwnership }
  from "../src/renderers/three/buildings/building-material-ownership";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

describe("building material resource ownership", () => {
  it("keeps the actual renderer's borrowed iron texture alive across repeated building disposal", () => {
    const definition = getBuildingDefinition(0), materials = createPlainBuildingMaterials();
    const map = new Texture(), onDispose = vi.fn();
    materials.iron.map = map; map.addEventListener("dispose", onDispose);
    const recipe = createNationBuildingRecipe(definition, "roman", false);
    recipe.parts = [{ shape: "iron-ingot", surface: "iron", stage: 0, position: [0, 0, 0], size: [.2, .1, .1] }];
    for (let cycle = 0; cycle < 10; cycle++) {
      const model = createRomanBuilding(definition, materials, false, recipe, "roman");
      model.dispose();
    }
    expect(onDispose).not.toHaveBeenCalled();
    Object.values(materials).forEach(material => material.dispose()); map.dispose();
  });

  it("releases the new HQ and stucco private materials while preserving the shared texture packs", () => {
    const cases = [["cloud-paint", "paint"], ["maya-civic-mask", "gold"],
      ["persian-palmette-panel", "plaster"]] as const;
    const definition = getBuildingDefinition(0);
    for (const [shape, surface] of cases) {
      const materials = createPlainBuildingMaterials(), shared = new Texture(), disposed = vi.fn();
      materials[surface].map = shared; materials[surface].normalMap = shared;
      shared.addEventListener("dispose", disposed);
      for (let cycle = 0; cycle < 4; cycle++) {
        const recipe = createNationBuildingRecipe(definition, "roman", false);
        recipe.parts = [{ position: [0, 0, 0], shape, size: [.2, .2, .02], stage: 2, surface } as BuildingPart];
        const model = createRomanBuilding(definition, materials, false, recipe, "roman");
        const privateDisposals: ReturnType<typeof vi.fn>[] = [];
        model.root.traverse(node => {
          if (!(node instanceof Mesh) || !node.userData.ownedMaterial) return;
          const material = node.material as MeshStandardMaterial;
          expect(material).not.toBe(materials[surface]);
          const event = vi.fn(); material.addEventListener("dispose", event); privateDisposals.push(event);
        });
        expect(privateDisposals.length).toBe(1); model.dispose();
        expect(privateDisposals.every(event => event.mock.calls.length === 1)).toBe(true);
      }
      expect(disposed).not.toHaveBeenCalled();
      Object.values(materials).forEach(material => material.dispose()); shared.dispose();
    }
  });

  it("does not dispose the iron material's borrowed pack textures", () => {
    const map = new Texture(), normal = new Texture();
    const source = new MeshStandardMaterial({ map, normalMap: normal });
    const onMap = vi.fn(), onNormal = vi.fn();
    map.addEventListener("dispose", onMap); normal.addEventListener("dispose", onNormal);
    ownBuildingMaterial(source.clone(), source, false).dispose();
    expect(onMap).not.toHaveBeenCalled(); expect(onNormal).not.toHaveBeenCalled();
    source.dispose(); map.dispose(); normal.dispose();
  });

  it("releases every new map including a separate statue bump map, deduplicated and exactly once", () => {
    const source = new MeshStandardMaterial({ normalMap: new Texture() });
    const albedo = new Texture(), bump = new Texture(), material = source.clone();
    const onAlbedo = vi.fn(), onBump = vi.fn(), onShared = vi.fn();
    albedo.addEventListener("dispose", onAlbedo); bump.addEventListener("dispose", onBump);
    source.normalMap!.addEventListener("dispose", onShared);
    material.map = albedo; material.bumpMap = bump; material.roughnessMap = bump;
    ownBuildingMaterial(material, source, true);
    material.dispose(); material.dispose();
    expect(onAlbedo).toHaveBeenCalledTimes(1); expect(onBump).toHaveBeenCalledTimes(1);
    expect(onShared).not.toHaveBeenCalled();
    source.normalMap!.dispose(); source.dispose();
  });

  it("keeps a placement ghost's private texture live until its last material is released", () => {
    const source = new MeshStandardMaterial(), original = source.clone(), map = new Texture();
    original.map = map; original.bumpMap = map;
    const disposeMap = vi.fn(); map.addEventListener("dispose", disposeMap);
    ownBuildingMaterial(original, source, true);
    const ghost = original.clone(); shareBuildingMaterialOwnership(original, ghost);
    original.dispose(); expect(disposeMap).not.toHaveBeenCalled();
    ghost.dispose(); ghost.dispose(); expect(disposeMap).toHaveBeenCalledTimes(1);
    source.dispose();
  });

  it("does not dispose intentionally cache-owned decorative maps", () => {
    const source = new MeshStandardMaterial(), cached = new Texture(), material = source.clone();
    const onDispose = vi.fn(); cached.addEventListener("dispose", onDispose);
    material.map = cached; material.bumpMap = cached;
    ownBuildingMaterial(material, source, false).dispose();
    expect(onDispose).not.toHaveBeenCalled();
    cached.dispose(); source.dispose();
  });
});
