import { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { type BuildingPart,createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { createNationRoofGeometry } from "../src/renderers/three/buildings/nation-roof-geometry";

const GUARDHOUSE = getBuildingDefinition(2);
const TIMBER_NATIONS = ["viking", "japanese"] as const;

/** Gradient of u over the triangle's plan (x, z): which way the tile courses run. */
const uGradient = (points: Vector3[], us: number[]) => {
  const [a, b, c] = points as [Vector3, Vector3, Vector3];
  const bx = b.x - a.x, bz = b.z - a.z, cx = c.x - a.x, cz = c.z - a.z;
  const du1 = us[1]! - us[0]!, du2 = us[2]! - us[0]!, det = bx * cz - bz * cx;
  return { x: (du1 * cz - du2 * bz) / det, z: (du2 * bx - du1 * cx) / det };
};

describe("Japanese hip roof", () => {
  const size = [1.7, .58, 2];
  const geometry = createNationRoofGeometry("japanese", true, size);
  const position = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
  const index = geometry.getIndex()!;

  it("runs the tile courses parallel to the eave on every face, hip ends included", () => {
    let hipEnds = 0, longSlopes = 0;
    for (let triangle = 0; triangle < index.count; triangle += 3) {
      const corners = [0, 1, 2].map(corner => index.getX(triangle + corner));
      const points = corners.map(vertex => new Vector3().fromBufferAttribute(position, vertex));
      const normal = new Vector3().subVectors(points[1]!, points[0]!).cross(new Vector3().subVectors(points[2]!, points[0]!));
      // Tile surface only: upward faces that are not tiny roll pieces.
      if (normal.y <= 0 || normal.length() < 1e-3) continue;
      const centre = points.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(3);
      const gradient = uGradient(points, corners.map(vertex => uv.getX(vertex)));
      // u counts courses down the slope: it changes only across the eave direction.
      if ((Math.abs(centre.z) * 2 - .5) * 2 > Math.abs(centre.x) * 2) {
        hipEnds++;
        expect(Math.abs(gradient.x)).toBeLessThan(1e-4);
      } else {
        longSlopes++;
        expect(Math.abs(gradient.z)).toBeLessThan(1e-4);
      }
    }
    expect(hipEnds).toBeGreaterThan(0);
    expect(longSlopes).toBeGreaterThan(0);
  });

  it("gives every drawn vertex a real normal (roll ends are not black)", () => {
    const normal = geometry.getAttribute("normal");
    for (let corner = 0; corner < index.count; corner++)
      expect(new Vector3().fromBufferAttribute(normal, index.getX(corner)).length()).toBeCloseTo(1, 3);
  });
});

describe("guardhouse hall", () => {
  /** Hall windows: thin dark panes wide enough to lean out of (tower slits are narrower). */
  const isPane = (part: BuildingPart) => part.surface === "dark" && part.shape === "box" && !part.militaryTower &&
    Math.min(...part.size) < .03 && part.size[1] >= .2 && Math.max(part.size[0], part.size[2]) >= .15;

  it("keeps the tower-side window on solid wall, clear of the side doorway", () => {
    for (const detailed of [true, false]) {
      const parts = createRomanBuildingRecipe(GUARDHOUSE, detailed).parts;
      const panes = parts.filter(part => isPane(part) && part.size[0] < .03);
      expect(panes.length).toBe(2);
      for (const pane of panes) {
        const window = getRomanPartBounds(pane);
        const backed = parts.some(wall => {
          const bounds = getRomanPartBounds(wall);
          return wall.surface === "stone" && wall.size[0] === .11 && Math.abs(wall.position[0] - pane.position[0]) < .1 &&
            bounds.min[2] <= window.min[2] && bounds.max[2] >= window.max[2] &&
            bounds.min[1] <= window.min[1] && bounds.max[1] >= window.max[1];
        });
        expect(backed, `${String(detailed)}/${pane.position.join(",")}`).toBe(true);
      }
    }
  });

  it.each(TIMBER_NATIONS)("frames %s windows with timber on the wall face", nation => {
    const parts = createNationBuildingRecipe(GUARDHOUSE, nation, true).parts;
    for (const pane of parts.filter(isPane)) {
      const window = getRomanPartBounds(pane);
      const members = parts.filter(part => {
        if (part.surface !== "wood" || part === pane) return false;
        const bounds = getRomanPartBounds(part);
        return [0, 1, 2].every(axis => bounds.min[axis]! <= window.max[axis]! + .002 &&
          bounds.max[axis]! >= window.min[axis]! - .002);
      });
      // Two jambs, head and sill touch every pane.
      expect(members.length, `${nation}/${pane.position.join(",")}`).toBeGreaterThanOrEqual(4);
    }
  });

  it.each(TIMBER_NATIONS)("hangs the %s occupation sign on the porch beam, not in the roof", nation => {
    const parts = createNationBuildingRecipe(GUARDHOUSE, nation, true).parts;
    // Nation decor (lanterns, fans, banners) is painted too; only the occupation sign is checked here.
    const paint = parts.filter(part => part.surface === "paint" && !part.nationDecor);
    expect(paint.length).toBeGreaterThan(0);
    const beam = parts.find(part => part.surface === "wood" && part.size[0] > 1.5 && part.size[1] === .13)!;
    const beamBounds = getRomanPartBounds(beam);
    for (const part of paint) {
      const bounds = getRomanPartBounds(part);
      expect(bounds.min[1]).toBeGreaterThanOrEqual(beamBounds.min[1] - .001);
      expect(bounds.max[1]).toBeLessThanOrEqual(beamBounds.max[1] + .001);
      expect(bounds.min[2]).toBeGreaterThan(beamBounds.max[2]);
    }
  });

  it.each(["viking", "nubian", "japanese"] as const)("gives %s interiors a nation floor, not the Roman mosaic", nation => {
    const parts = createNationBuildingRecipe(GUARDHOUSE, nation, true).parts;
    expect(parts.some(part => part.surface === "mosaic")).toBe(false);
    const floor = parts.find(part => part.stage === 0 && part.size[1] <= .04 && part.size[0] > 1)!;
    expect(floor.surface).toBe(nation === "nubian" ? "stone" : "planks");
    expect(floor.worldUv).toBe(1);
  });
});
