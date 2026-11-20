import { expect, it } from "vitest";

import { BUILDING_CATALOG, getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { wellCrankHandTarget } from "../src/render-common/buildings/well-work-cycle";
import { WORKER_HEIGHT, WORKER_RADIUS } from "../src/render-common/workers/worker-dimensions";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { wellBucketPickupContact, wellWorkstation } from "../src/shared/settlement/settlement-well-work";

it.each([true, false])("keeps every spare Indigenous basket close to its real shelter at every tier (%s)", detailed => {
  let baskets = 0;
  for (const definition of BUILDING_CATALOG) for (const level of [1, 2, 3, 4, 5] as const) {
    const recipe = leveledBuildingRecipe(definition, "indigenous", detailed, level);
    const skins = recipe.parts.filter(part => {
      if (part.stock || part.workyardAssembly === "indigenous-spare-basket") return false;
      const bounds = getRomanPartBounds(part);
      return bounds.min[1] < .06 && bounds.max[1] > .45;
    });
    for (const basket of recipe.parts.filter(part => part.shape === "cylinder" && part.surface === "straw" &&
      part.workyardAssembly === "indigenous-spare-basket")) {
      baskets++;
      const [x, , z] = basket.position;
      const distance = Math.min(...skins.map(skin => {
        const box = getRomanPartBounds(skin);
        return Math.hypot(Math.max(0, box.min[0] - x, x - box.max[0]),
          Math.max(0, box.min[2] - z, z - box.max[2]));
      }));
      expect(distance, `${definition.id}/L${level}: small basket stays within a handspan of the shelter`)
        .toBeLessThanOrEqual(.311);
      expect(basket.stock).toBeUndefined();
      expect(getRomanPartBounds(basket).min[1], `${definition.id}/L${level}: basket is grounded`)
        .toBeLessThanOrEqual(.011);
      for (const point of [recipe.workerExit, recipe.workPoint])
        expect(Math.hypot(x - point[0], z - point[2])).toBeGreaterThanOrEqual(.46);
    }
  }
  expect(baskets).toBeGreaterThan(50);
});

it.each([true, false])("keeps the complete well lamp and jar stand behind body, hand and bucket workspaces (%s)", detailed => {
  const definition = getBuildingDefinition(35), { scale } = getRomanBuildingWorldSizing(definition);
  const recipe = leveledBuildingRecipe(definition, "indigenous", detailed, 5);
  const lamp = recipe.parts.find(part => part.surface === "amber")!;
  const jar = recipe.parts.find(part => part.shape === "clay-jar" && !part.stock)!;
  expect(lamp).toBeDefined(); expect(jar).toBeDefined();
  expect(lamp.position[2]).toBeLessThan(-.65);
  expect(jar.position[2]).toBeLessThan(-.65);
  // This detects the original front-left post intersection using unchanged canonical body size.
  expect(Math.hypot(-.4 * scale + .205, .78 * scale - .64)).toBeLessThan(WORKER_RADIUS);
  for (const rotation of [0, 1, 2, 3]) {
    const building = { rotation, x: 0, y: 0, z: 0 } as SettlementBuilding;
    const station = wellWorkstation(building, "indigenous");
    const pickup = wellBucketPickupContact(building, "indigenous");
    const angle = rotation * Math.PI / 2;
    for (const prop of [lamp, jar]) {
      const [x, , z] = prop.position;
      const px = (x * Math.cos(angle) + z * Math.sin(angle)) * scale;
      const pz = (-x * Math.sin(angle) + z * Math.cos(angle)) * scale;
      for (const point of [station.point, pickup.approach, pickup.stock])
        expect(Math.hypot(px - point.x, pz - point.z)).toBeGreaterThan(WORKER_RADIUS + .16 * scale);
      for (let elapsed = 0; elapsed < 14; elapsed += .05) {
        const hand = wellCrankHandTarget({ ...station.frame, elapsed });
        expect(Math.hypot(px - hand[0], pz - hand[2])).toBeGreaterThan(.16 * scale);
      }
    }
  }
  expect(new Set(recipe.parts.filter(part => part.stock).map(part => part.stock!.slot)).size).toBe(6);
});

it.each([true, false])("retains canopy and connected supports inside the original cap at L2–5 (%s)", detailed => {
  const definition = getBuildingDefinition(35), { scale } = getRomanBuildingWorldSizing(definition);
  const base = leveledBuildingRecipe(definition, "indigenous", detailed, 1);
  const cap = Math.max(...base.parts.map(part => getRomanPartBounds(part).max[1])) * 1.3;
  for (const level of [2, 3, 4, 5] as const) {
    const recipe = leveledBuildingRecipe(definition, "indigenous", detailed, level);
    const roof = recipe.parts.filter(part => part.occupationRoof === "gable" && part.surface === "cloth-water");
    expect(roof.length, `L${level}: settling must not silently delete the canopy`).toBe(1);
    const bounds = getRomanPartBounds(roof[0]!);
    expect(bounds.min[1] * scale).toBeGreaterThan(WORKER_HEIGHT + .025);
    expect(bounds.max[1]).toBeLessThanOrEqual(cap);
    const extensions = recipe.parts.filter(part => part.shape === "cylinder" && part.surface === "bark" &&
      part.position[1] > recipe.mechanism[1] + .18);
    expect(extensions.length).toBe(2);
    for (const post of extensions) {
      const postBounds = getRomanPartBounds(post);
      expect(postBounds.min[1]).toBeLessThan(recipe.mechanism[1] + .18);
      expect(postBounds.max[1]).toBeGreaterThan(bounds.max[1] - .012);
    }
    expect(recipe.parts.filter(part => part.shape === "bevel-box" && part.surface === "wood" &&
      part.position[1] > bounds.min[1] - .04).length).toBe(6);
  }
});
