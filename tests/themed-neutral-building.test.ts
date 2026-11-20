import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import {
  getRomanPartBounds,
  getRomanRecipeBounds
} from "../src/render-common/buildings/building-recipe-fit";
import { createNeutralBuildingRecipe } from "../src/render-common/buildings/neutral-building-recipe";
import { createThemedNeutralBuildingRecipe } from "../src/render-common/buildings/themed-neutral-building-recipe";
import {
  type EnemyBuildingStyle,
  enemyBuildingStyleKey,
  stableEnemyModel} from "../src/render-common/buildings/themed-neutral-building-style";
import { ADVENTURE_THEMES } from "../src/shared/settlement/adventure-themes";
import { neutralBuildingTriangleLimit } from "./helpers/neutral-building-budgets";

/** Dark-surface parts per compound model (0: one, 1: two, 2: none). */
const DARK_PARTS_BY_MODEL = [1, 2, 0] as const;
const styles: EnemyBuildingStyle[] = [
  ...ADVENTURE_THEMES.map((theme) => ({ theme })),
  { theme: "tropical", variant: "pirate" }
].flatMap((style) =>
  ([0, 1, 2] as const).map((model) => ({ ...style, model }))
) as EnemyBuildingStyle[];
it.each(styles)("keeps every operational/window/stock contract for $theme/$variant", (style) => {
  for (const id of [2, 4, 9])
    for (const detailed of [true, false]) {
      const definition = getBuildingDefinition(id),
        base = createNeutralBuildingRecipe(definition, detailed);
      const recipe = createThemedNeutralBuildingRecipe(definition, style, detailed);
      const { parts: before, ...beforeAnchors } = base,
        { parts, ...anchors } = recipe;
      expect(anchors).toEqual(beforeAnchors);
      expect(parts.filter((part) => part.stock)).toEqual(before.filter((part) => part.stock));
      expect(parts.filter((part) => part.surface === "dark")).toHaveLength(
        DARK_PARTS_BY_MODEL[style.model ?? 0]
      );
      const limit = getRomanRecipeBounds(definition, base),
        after = getRomanRecipeBounds(definition, recipe);
      expect(after.extentX).toBeLessThanOrEqual(limit.extentX + 1e-5);
      expect(after.extentZ).toBeLessThanOrEqual(limit.extentZ + 1e-5);
      const center = recipe.door[0] + (recipe.doorDimensions?.width ?? 0.46) / 2,
        front = recipe.door[2] - 0.016;
      expect(
        parts.filter((part) => {
          if (part.shape === "stone-arc") return false;
          const { max, min } = getRomanPartBounds(part);
          return (
            min[0] < center + 0.31 &&
            max[0] > center - 0.31 &&
            min[1] < 0.82 &&
            max[1] > 0.025 &&
            min[2] < front + 0.95 &&
            max[2] > front + 0.19
          );
        })
      ).toEqual([]);
      expect(parts.every((part) => [...part.position, ...part.size].every(Number.isFinite))).toBe(
        true
      );
      expect(recipe.hideFlag).toBe(true);
    }
});
it("does not leak nautical style into other climates or replace legacy originals", () => {
  const definition = getBuildingDefinition(4);
  for (const theme of ADVENTURE_THEMES.filter((theme) => theme !== "tropical")) {
    expect(createThemedNeutralBuildingRecipe(definition, { theme, variant: "pirate" })).toEqual(
      createThemedNeutralBuildingRecipe(definition, { theme })
    );
    expect(enemyBuildingStyleKey({ theme, variant: "pirate" })).toBe(`${theme}:bandit`);
  }
  expect(createThemedNeutralBuildingRecipe(getBuildingDefinition(1), { theme: "winter" })).toEqual(
    createNeutralBuildingRecipe(getBuildingDefinition(1))
  );
});
it("keeps themed real model budgets in both qualities", async () => {
  const { MeshStandardMaterial } = await import("three");
  const { createNeutralBuilding } =
    await import("../src/renderers/three/buildings/neutral-building");
  const material = new MeshStandardMaterial();
  const materials = new Proxy({}, { get: () => material }) as Record<
    import("../src/render-common/buildings/building-recipe").BuildingSurface,
    typeof material
  >;
  try {
    for (const style of styles)
      for (const id of [2, 4, 9])
        for (const detailed of [true, false]) {
          const model = createNeutralBuilding(
            getBuildingDefinition(id),
            materials,
            detailed,
            style
          );
          model.update(0, { construction: 1, door: 1, working: false });
          expect(
            model.triangles(false),
            `${id}/${style.theme}/${style.variant}/${detailed}`
          ).toBeLessThanOrEqual(neutralBuildingTriangleLimit(id, detailed));
          expect(model.root.userData.enemyBuildingStyle).toBe(enemyBuildingStyleKey(style));
          expect(model.root.getObjectByName("player_flag_mount")).toBeUndefined();
          model.dispose();
        }
  } finally {
    material.dispose();
  }
});
it("chooses repeatable architectural variants without using the player nation or quality", () => {
  const selected = Array.from({ length: 30 }, (_, id) => stableEnemyModel(`settlement-${id}`));
  expect(new Set(selected).size).toBe(3);
  expect(selected).toEqual(
    Array.from({ length: 30 }, (_, id) => stableEnemyModel(`settlement-${id}`))
  );
});
