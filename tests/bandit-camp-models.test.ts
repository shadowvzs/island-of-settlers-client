import { MeshStandardMaterial } from "three";
import { expect, it } from "vitest";

import {
  banditCampPlan, banditSiteOfMilitaryType, placedBanditCamp
} from "../src/render-common/buildings/bandit-camp-plan";
import { createBanditCampRecipe } from "../src/render-common/buildings/bandit-camp-recipe";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { garrisonSlots } from "../src/render-common/buildings/military-garrison-slots";
import type { EnemyBuildingStyle } from "../src/render-common/buildings/themed-neutral-building-style";
import { createNeutralBuilding } from "../src/renderers/three/buildings/neutral-building";
import { COLONY_DIFFICULTIES } from "../src/shared/balance/colonies";
import { ADVENTURE_THEMES } from "../src/shared/settlement/adventure-themes";
import { colonyFortPlans } from "../src/shared/settlement/colony-island-rules";
import { neutralBuildingTriangleLimit } from "./helpers/neutral-building-budgets";

it("keeps event stockades separate from freestanding colony defender buildings", () => {
  for (const type of [2, 4, 9]) for (const model of [0, 1, 2] as const)
    for (const detailed of [false, true]) {
      const site = banditSiteOfMilitaryType(type, model);
      const style = { bandit: site, theme: "forest" as const };
      const event = createBanditCampRecipe(site, style, detailed);
      const building = createBanditCampRecipe(site, { ...style, enclosure: "building" }, detailed);
      const plan = banditCampPlan(site);
      if (plan.kind === "tower") {
        expect(building).toEqual(event);
        continue;
      }
      expect(building.parts.some(part => part.shape === "camp-dressing")).toBe(false);
      expect(event.parts.some(part => part.shape === "camp-dressing")).toBe(true);
      expect(building.parts.filter(part => part.surface === "dark")).toHaveLength(2);
      const slots = garrisonSlots(type, "roman", detailed, site, true, "building");
      expect(slots.filter(slot => slot.kind === "window")).toHaveLength(2);
      expect(building.archerPositions).toEqual(event.archerPositions);
      expect(building.door).toEqual(event.door);
      for (const part of building.parts) {
        const { max, min } = getRomanPartBounds(part);
        expect(min[0]).toBeGreaterThanOrEqual(-plan.cells[0] / 2);
        expect(max[0]).toBeLessThanOrEqual(plan.cells[0] / 2);
        expect(min[2]).toBeGreaterThanOrEqual(-plan.cells[1] / 2);
        expect(max[2]).toBeLessThanOrEqual(plan.cells[1] / 2);
      }
    }
});

it("new neutral layouts occupy 2–8 tiles, keep their gate clear and put archers on real platforms", () => {
  for (const type of [2, 4, 9])
    for (const model of [0, 1, 2] as const)
      for (const theme of ADVENTURE_THEMES)
        for (const detailed of [false, true]) {
          const site = banditSiteOfMilitaryType(type, model);
          const plan = banditCampPlan(site),
            recipe = createBanditCampRecipe(site, { bandit: site, theme }, detailed);
          expect(plan.cells.every((size) => size >= 2 && size <= 8)).toBe(true);
          for (const part of recipe.parts) {
            const { max, min } = getRomanPartBounds(part);
            expect(min[0]).toBeGreaterThanOrEqual(-plan.cells[0] / 2);
            expect(max[0]).toBeLessThanOrEqual(plan.cells[0] / 2);
            expect(min[2]).toBeGreaterThanOrEqual(-plan.cells[1] / 2);
            expect(max[2]).toBeLessThanOrEqual(plan.cells[1] / 2);
            expect([...part.position, ...part.size].every(Number.isFinite)).toBe(true);
          }
          for (const [x, y, z] of recipe.archerPositions ?? [])
            expect(
              recipe.parts.some((part) => {
                const { max, min } = getRomanPartBounds(part);
                return (
                  part.surface === "planks" &&
                  x >= min[0] &&
                  x <= max[0] &&
                  z >= min[2] &&
                  z <= max[2] &&
                  Math.abs(max[1] - y) < 0.001
                );
              })
            ).toBe(true);
          const slots = garrisonSlots(type, "japanese", detailed, site, true);
          expect(
            slots.filter((slot) => slot.kind === "archer").map((slot) => slot.position)
          ).toEqual(recipe.archerPositions);
          expect(recipe.hideFlag).toBe(true);
          expect(recipe.hideDoor).toBe(plan.kind === "tower");
          for (const turns of [0, 1, 2, 3]) {
            const placed = placedBanditCamp(site, 20, 20, turns);
            expect(placed.width).toBe(plan.cells[turns % 2 ? 1 : 0]);
            expect(Math.hypot(placed.access.x - 20, placed.access.z - 20)).toBe(
              plan.cells[1] / 2 + 0.5
            );
          }
        }
});

it("actual neutral compound meshes remain inexpensive on Minimal and omit flags and tower doors", () => {
  const material = new MeshStandardMaterial(),
    materials = new Proxy({}, { get: () => material }) as Record<
      BuildingSurface,
      MeshStandardMaterial
    >;
  try {
    for (const type of [2, 4, 9])
      for (const model of [0, 1, 2] as const)
        for (const detailed of [false, true]) {
          const site = banditSiteOfMilitaryType(type, model);
          const style: EnemyBuildingStyle = { bandit: site, theme: "tropical", variant: "pirate" };
          const built = createNeutralBuilding(
            getBuildingDefinition(type),
            materials,
            detailed,
            style
          );
          built.update(0.4, { construction: 1, door: 1, working: false });
          built.fitToGrid();
          expect(built.root.scale.x).toBe(1);
          expect(built.root.getObjectByName("player_flag_mount")).toBeUndefined();
          expect(built.triangles(false)).toBeLessThanOrEqual(
            neutralBuildingTriangleLimit(type, detailed, 3500)
          );
          expect(built.root.userData.garrisonCapacity).toBe(banditCampPlan(site).capacity);
          built.dispose();
        }
  } finally {
    material.dispose();
  }
});

it("new camp garrisons respect their own capacities while preserving island defender totals", () => {
  for (const difficulty of ["easy", "medium", "hard"] as const) {
    for (const seed of [0, 1, 2]) {
      const plans = colonyFortPlans(difficulty, seed);
      expect(plans.reduce((sum, plan) => sum + plan.troops.length, 0)).toBe(
        COLONY_DIFFICULTIES[difficulty].enemyTroops
      );
      for (const plan of plans) {
        const camp = banditCampPlan(plan.bandit!);
        expect(plan.troops.length).toBeLessThanOrEqual(camp.capacity);
        if (camp.kind === "tower")
          expect(plan.troops.every((type) => type === "archer")).toBe(true);
      }
    }
  }
});

it("chooses all three stable model families across island seeds", () => {
  const models = [0, 1, 2].map((seed) => colonyFortPlans("easy", seed)[0]!.bandit?.layout);
  expect(models).toEqual([0, 1, 2]);
  expect(colonyFortPlans("easy", 5)).toEqual(colonyFortPlans("easy", 5));
});
