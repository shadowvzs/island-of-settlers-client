import { Group, type Mesh } from "three";
import { expect, it } from "vitest";

import { addShipDeck, type DeckOutline, SHIP_DECK_LEVELS } from "../src/renderers/three/settlement/ship-deck-planking";
import {
  bandSections, hullDeckOutline, type HullForm, hullPoint
} from "../src/renderers/three/settlement/ship-hull-loft";
import { createShipKit } from "../src/renderers/three/settlement/ship-kit";
import { createShipMaterials } from "../src/renderers/three/settlement/ship-materials";

const FORM: HullForm = {
  beam: t => Math.max(.03, Math.sin(t * Math.PI) ** .6 * .43),
  depth: t => FORM.sheer(t) + .14,
  section: a => [Math.cos(a * Math.PI / 2), Math.sin(a * Math.PI / 2)],
  sheer: t => .225 + Math.abs(t - .5) ** 2 * .4
};

const outlineWidth = (outline: DeckOutline, z: number) => {
  for (let index = 1; index < outline.length; index++) {
    const [previousZ, previousWidth] = outline[index - 1]!, [nextZ, nextWidth] = outline[index]!;
    if (z < previousZ - 1e-5 || z > nextZ + 1e-5) continue;
    return previousWidth + (nextWidth - previousWidth) * (z - previousZ) / (nextZ - previousZ || 1);
  }
  return 0;
};

const deckPlanks = (detailed: boolean, outline: DeckOutline) => {
  const { materials } = createShipMaterials();
  const kit = createShipKit(detailed, materials, geometry => geometry, geometry => geometry);
  const group = new Group();
  addShipDeck(kit, group, outline);
  return (group.children as Mesh[]).find(mesh => mesh.material === materials.deck)!.geometry;
};

it.each([true, false])("plank ends close onto the hull outline instead of stepping short (High=%s)", detailed => {
  const rings = detailed ? 23 : 9, sections = bandSections(0, 1, detailed ? 8 : 3);
  const outline = hullDeckOutline(FORM, rings, sections, SHIP_DECK_LEVELS);
  const positions = deckPlanks(detailed, outline).getAttribute("position");
  let reachesSkin = 0;
  for (let index = 0; index < positions.count; index++) {
    const x = Math.abs(positions.getX(index)), y = positions.getY(index), z = positions.getZ(index);
    const width = outlineWidth(outline, z);
    expect(x).toBeLessThanOrEqual(width + 1e-6);
    if (Math.abs(y - SHIP_DECK_LEVELS.top) < 1e-6 && width - x < 1e-4) reachesSkin++;
  }
  // Every plank end lies on the outline: two ends per plank edge sample.
  expect(reachesSkin).toBeGreaterThan(positions.count / 4);
});

it("the outline stays inside the planking skin at the deck heights", () => {
  const outline = hullDeckOutline(FORM, 23, bandSections(0, 1, 8), SHIP_DECK_LEVELS);
  outline.slice(1, -1).forEach(([, width], ring) => {
    const t = (ring + 1) / 22, skin = hullPoint(FORM, t, 0, 1)[0];
    expect(width).toBeLessThan(skin);
    expect(width).toBeGreaterThan(skin * .9);
  });
});
