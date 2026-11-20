import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";

const headquarters = (detailed: boolean) =>
  leveledBuildingRecipe(getBuildingDefinition(0), "persian", detailed, 5);

const near = (value: number, expected: number, tolerance = 1e-9) =>
  Math.abs(value - expected) <= tolerance;

const inDomedRoom = (part: BuildingPart) =>
  near(part.position[0], 0, 1e-6) && near(part.position[2], -.36, 1e-6);

const domeTrim = (parts: readonly BuildingPart[]) => parts.find(part =>
  part.shape === "cylinder" && part.surface === "plaster" && inDomedRoom(part) &&
  part.position[1] > 1.6 && part.position[1] < 1.9 && part.size[1] < .2);

const upperBands = (parts: readonly BuildingPart[]) => parts.filter(part =>
  part.surface === "paint" && inDomedRoom(part) && part.position[1] > 1.4 && part.size[0] > 1);

it.each([true, false])("keeps the dome cornice an open lit trim under the roof (%s)", detailed => {
  const recipe = headquarters(detailed), ring = domeTrim(recipe.parts);
  const dome = recipe.parts.find(part => part.shape === "ogive-dome" && inDomedRoom(part));
  expect(ring).toBeDefined();
  expect(dome).toBeDefined();
  // An open tube has no top cap: the cap used to read as a bright horizontal ledge at night.
  expect(ring!.openEnded).toBe(true);
  expect(ring!.surface).toBe("plaster");
  // The trim is proud of the room wall but stops inside the dome lip, so the rim is covered.
  const room = recipe.parts.find(part => part.shape === "persian-room" && inDomedRoom(part) &&
    part.surface === "plaster" && part.size[1] > 1.5);
  expect(room).toBeDefined();
  expect(ring!.size[0]).toBeGreaterThan(room!.size[0]);
  expect(ring!.size[0]).toBeLessThan(dome!.size[0]);
  const ringTop = ring!.position[1] + ring!.size[1] / 2;
  const domeBottom = dome!.position[1] - dome!.size[1] / 2;
  expect(near(ringTop, domeBottom)).toBe(true);
});

it.each([true, false])("uses open upper bands, never annular shells or ledges (%s)", detailed => {
  const bands = upperBands(headquarters(detailed).parts);
  expect(bands.length).toBeGreaterThanOrEqual(3);
  for (const band of bands) {
    expect(band.shape).toBe("cylinder");
    expect(band.openEnded).toBe(true);
  }
  // The cobalt band's exposed top edge sits under the cream fascia (proud and overlapping).
  const cobalt = bands.find(band => (band.tint?.[0] ?? 1) < .1);
  const cream = bands.find(band => band.tint?.[0] === .96 && band.tint?.[1] === .88);
  expect(cobalt).toBeDefined();
  expect(cream).toBeDefined();
  expect(cream!.position[1] - cream!.size[1] / 2)
    .toBeLessThanOrEqual(cobalt!.position[1] + cobalt!.size[1] / 2);
  expect(cream!.size[0]).toBeGreaterThan(cobalt!.size[0]);
});

it.each([true, false])("insets the vault cap and covers its springing with one open course (%s)", detailed => {
  const parts = headquarters(detailed).parts;
  const wing = parts.find(part => part.shape === "persian-room" && part.surface === "plaster" &&
    near(part.position[0], 1.3, 1e-6) && part.size[0] > .7 && part.size[1] > 1);
  const cap = parts.find(part => part.shape === "persian-room" && part.occupationRoof === "barrel" &&
    near(part.position[0], 1.3, 1e-6) && near(part.position[2], -.28, 1e-6));
  const springer = parts.find(part => part.shape === "cylinder" && part.openEnded === true &&
    near(part.position[0], 1.3, 1e-6) && near(part.position[2], -.28, 1e-6) && part.surface === "plaster");
  expect(wing).toBeDefined();
  expect(cap).toBeDefined();
  expect(springer).toBeDefined();
  // Equal-width hollow shells z-fought along their 6 % overlap; the cap is inset instead.
  expect(cap!.size[0]).toBeLessThan(wing!.size[0]);
  expect(cap!.size[2]).toBeLessThan(wing!.size[2]);
  const springerBottom = springer!.position[1] - springer!.size[1] / 2;
  const springerTop = springer!.position[1] + springer!.size[1] / 2;
  expect(springerBottom).toBeLessThanOrEqual(wing!.position[1] + wing!.size[1] / 2);
  expect(springerTop).toBeGreaterThanOrEqual(wing!.position[1] + wing!.size[1] / 2);
  expect(springer!.size[0]).toBeGreaterThan(wing!.size[0]);
});
