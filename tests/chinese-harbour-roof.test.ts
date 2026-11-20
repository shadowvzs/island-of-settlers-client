import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { chineseRoofSoffit } from "../src/render-common/buildings/chinese-roof-bearings";
import type { BuildingLevel } from "../src/render-common/buildings/levels/building-level";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { ROMAN_HARBOR_BEACON_POSITION } from "../src/render-common/buildings/roman-harbor";
import { HARBOUR_TYPE_ID } from "../src/shared/settlement/building-type-ids";

const [towerX, , towerZ] = ROMAN_HARBOR_BEACON_POSITION;
const TOWER_RADIUS = .41;
const BED_THICKNESS = .07;
const cases = ([1, 3, 5] as const).flatMap(level => [true, false].map(detailed => [level, detailed] as const));
const recipeOf = (level: BuildingLevel, detailed: boolean) =>
  leveledBuildingRecipe(getBuildingDefinition(HARBOUR_TYPE_ID), "chinese", detailed, level);
const hallRoofOf = (parts: readonly BuildingPart[]) => parts.find(part => {
  if (part.shape !== "occupation-roof") return false;
  const bounds = getRomanPartBounds(part);
  return bounds.min[0] < towerX && bounds.max[0] > towerX && bounds.min[2] < towerZ && bounds.max[2] > towerZ &&
    bounds.max[1] < 2;
})!;

describe.each(cases)("Chinese harbour hall roof (level %i, detailed %s)", (level, detailed) => {
  const { parts } = recipeOf(level, detailed);
  const roof = hallRoofOf(parts);

  it("projects its eave clearly beyond the beacon tower on the west and back", () => {
    const bounds = getRomanPartBounds(roof);
    expect(towerX - TOWER_RADIUS - bounds.min[0]).toBeGreaterThan(.1);
    expect(towerZ - TOWER_RADIUS - bounds.min[2]).toBeGreaterThan(.1);
  });

  it("seals the whole tower/roof junction above the flashing collar's foot", () => {
    const collar = parts.find(part => part.shape === "ring" && part.surface === roof.surface &&
      Math.hypot(part.position[0] - towerX, part.position[2] - towerZ) < 1e-6);
    expect(collar).toBeDefined();
    const foot = collar!.position[1] - collar!.size[1] / 2, radius = collar!.size[0] / 2;
    for (let step = 0; step < 32; step++) {
      const angle = step * Math.PI / 16;
      const x = towerX + Math.cos(angle) * TOWER_RADIUS, z = towerZ + Math.sin(angle) * TOWER_RADIUS;
      const soffit = chineseRoofSoffit(roof, x, z, detailed);
      expect(soffit, `roof under tower face at ${step}`).not.toBeNull();
      // The bedding slab's top lies BED_THICKNESS (unit height) above its soffit.
      const top = soffit! + BED_THICKNESS * roof.size[1];
      expect(top, `junction ${step} buries the collar foot`).toBeGreaterThan(foot);
      const outer = chineseRoofSoffit(roof, towerX + Math.cos(angle) * radius,
        towerZ + Math.sin(angle) * radius, detailed);
      expect(outer, `collar foot ${step} stays over the roof`).not.toBeNull();
    }
  });

  it("keeps every eave purlin under the actual roof bedding", () => {
    const roofs = parts.filter(part => part.shape === "occupation-roof" && part.roofTiles === "pan-cover");
    const purlins = parts.filter(part => part.roofSupport && part.shape === "box" && part.rotation);
    expect(purlins.length).toBeGreaterThan(0);
    for (const purlin of purlins) {
      const [pitch = 0, yaw = 0] = purlin.rotation!;
      const half = purlin.size[2] / 2;
      for (let step = 0; step <= 8; step++) {
        const share = step / 4 - 1;
        const x = purlin.position[0] + Math.sin(yaw) * Math.cos(pitch) * half * share;
        const y = purlin.position[1] - Math.sin(pitch) * half * share + purlin.size[1] / 2;
        const z = purlin.position[2] + Math.cos(yaw) * Math.cos(pitch) * half * share;
        const soffits = roofs.map(candidate => chineseRoofSoffit(candidate, x, z, detailed))
          .filter((value): value is number => value !== null);
        if (!soffits.length) continue;
        expect(y, `purlin top at ${x.toFixed(3)}, ${z.toFixed(3)}`).toBeLessThanOrEqual(Math.max(...soffits) + .003);
      }
    }
  });

  it("drops only the tower slit window buried inside the hall attic", () => {
    const panes = parts.filter(part => part.surface === "dark" && part.size[1] > .15 &&
      Math.hypot(part.position[0] - towerX, part.position[2] - towerZ) < TOWER_RADIUS + .05);
    expect(panes.length).toBeGreaterThan(0);
    for (const pane of panes) expect(getRomanPartBounds(pane).min[1]).toBeGreaterThan(1.5);
  });
});
