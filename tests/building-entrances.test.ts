import { Box3, Euler, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from "three";
import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";

/** Keep a worker-sized approach clear beyond the doorway trim on both LODs. */
it.each(
  BUILDING_CATALOG.filter((b) => b.style !== "well").flatMap((definition) =>
    [true, false].map((detailed) => ({ definition, detailed, name: definition.name }))
  )
)("$name doorway stays clear (detail: $detailed)", ({ definition, detailed }) => {
  const recipe = createRomanBuildingRecipe(definition, detailed);
  const center = recipe.door[0] + (recipe.doorDimensions?.width ?? 0.46) / 2;
  const front = recipe.door[2] - 0.016;
  const corridor = new Box3(
    new Vector3(center - 0.31, 0.025, front + 0.19),
    new Vector3(center + 0.31, 0.82, front + 0.95)
  );
  const blocked = recipe.parts.filter((part) => {
    const matrix = new Matrix4().compose(
      new Vector3(...part.position),
      new Quaternion().setFromEuler(new Euler(...(part.rotation ?? [0, 0, 0]), "ZYX")),
      new Vector3(...part.size)
    );
    const bounds = new Box3();
    if (part.shape === "stone-arc") {
      // Arc masonry occupies its actual curved sector, not a full unit cube.
      for (let i = 0; i <= 24; i++) {
        const angle = (i / 24) * (Math.PI / 6 - 0.009);
        for (const radius of [0.38, 0.5])
          for (const y of [-0.5, 0.5])
            bounds.expandByPoint(
              new Vector3(Math.sin(angle) * radius, y, Math.cos(angle) * radius).applyMatrix4(
                matrix
              )
            );
      }
    } else {
      bounds.set(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5)).applyMatrix4(matrix);
    }
    return bounds.intersectsBox(corridor);
  });
  expect(blocked.map((part) => ({ surface: part.surface, position: part.position }))).toEqual([]);
});

// Include moving machinery: static recipe bounds alone cannot catch working-state obstructions.
// Armory24's hammer belongs to its worker; its intentionally empty model mechanism cannot sweep this corridor.
it.each(BUILDING_CATALOG.filter((b) => b.style !== "well" && b.mechanism !== "none" && b.id !== 24))(
  "$name working mechanism never crosses the entrance",
  (definition) => {
    expect.hasAssertions();
    const material = new MeshStandardMaterial();
    const surfaces: BuildingSurface[] = [
      "mosaic", "rope",
      "rope",
      "paint",
      "plaster",
      "stone",
      "wood",
      "roof",
      "iron",
      "steel",
      "cloth",
      "leaf",
      "dark",
      "gold",
      "bark",
      "endgrain",
      "fish",
      "sacking",
      "straw",
      "amber", "copper", "cut-stone", "bread"
    ];
    const materials = Object.fromEntries(surfaces.map((s) => [s, material])) as Record<
      BuildingSurface,
      MeshStandardMaterial
    >;
    const model = createRomanBuilding(definition, materials, true);
    const center = model.recipe.door[0] + (model.recipe.doorDimensions?.width ?? 0.46) / 2;
    const front = model.recipe.door[2] - 0.016;
    const corridor = new Box3(
      new Vector3(center - 0.31, 0.025, front + 0.19),
      new Vector3(center + 0.31, 0.82, front + 0.95)
    );
    const mechanism = model.root.getObjectByName("mechanism")!;
    for (let i = 0; i < 32; i++) {
      model.update(i / 8, { construction: 1, working: true, door: 1 });
      model.root.updateMatrixWorld(true);
      if (mechanism.children.length)
        expect(new Box3().setFromObject(mechanism).intersectsBox(corridor)).toBe(false);
    }
    model.dispose();
    material.dispose();
  }
);
