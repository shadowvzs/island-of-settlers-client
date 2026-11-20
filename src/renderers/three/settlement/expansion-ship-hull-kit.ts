import { BufferGeometry, Float32BufferAttribute, type Group } from "three";

import { SHIP_DECK } from "../../../render-common/ships/ship-deck-layout";
import { addHatchCoaming, addHatchGrating, addMooringCleats } from "./roman-ship-hull";
import { addShipDeck, SHIP_DECK_LEVELS } from "./ship-deck-planking";
import { bandSections, gunwaleLine, hullBand, hullDeckOutline, hullEndCap, type HullForm } from "./ship-hull-loft";
import type { ShipKit } from "./ship-kit";
import type { ShipMaterialName } from "./ship-materials";
import { createShipOrnamentParts } from "./ship-ornaments";

/** The bulwark top: the painted strake rises this far (in section units) above the gunwale. */
const BULWARK = -.06;
/** The painted strake runs from the bulwark top down to here, the timber planking below. */
const STRAKE = .13;

/** Shared merchant working deck; only the surrounding shell and cultural fittings change. */
export const addExpansionHull = (kit: ShipKit, group: Group, form: HullForm,
  timber: ShipMaterialName, trim: ShipMaterialName) => {
  const rings = kit.detailed ? 23 : 9, rows = kit.detailed ? 8 : 3;
  kit.mesh(group, timber, kit.temp(hullBand(form, { from: STRAKE, rings, rows, to: 1 })));
  kit.mesh(group, trim, kit.temp(hullBand(form, { from: BULWARK, rings, rows: 1, to: STRAKE })));
  // Bow and stern panels close the whole shell, bulwark top included, so the rails end on timber.
  for (const end of [0, 1]) kit.mesh(group, timber,
    kit.temp(hullEndCap(form, end, kit.detailed ? 8 : 4, end ? 1 : -1, BULWARK)));
  for (const side of [-1, 1]) kit.curve(group, timber,
    gunwaleLine(form, side, rings, { a: BULWARK, lift: .006, out: .004 }), .013, kit.detailed ? 28 : 9);
  const deckSections = [BULWARK, ...bandSections(STRAKE, 1, rows)];
  addShipDeck(kit, group, hullDeckOutline(form, rings, deckSections, SHIP_DECK_LEVELS));
  kit.add(group, timber, [.5, .035, .20], [0, .2825, -.925]);
  for (let step = 0; step < 3; step++) kit.add(group, timber, [.23, .025, .055],
    [0, .22 + step * .025, -.72 - step * .045]);
  // The canonical wheel and its grip contacts stay unchanged; its stand now meets the quarterdeck.
  kit.add(group, timber, [.055, .061, .06], [0, .3305, -.932]);
  for (const part of createShipOrnamentParts(kit.detailed, kit.temp,
    { bronze: kit.materials.bronze, wood: kit.materials[timber] })) group.add(part);
  addHatchCoaming(kit, group, timber);
  if (kit.detailed) for (const side of [-1, 1]) for (const z of [-.58, -.35])
    kit.add(group, timber, [.08, .025, .025], [side * .35, .235, z]);
  if (kit.detailed) { addHatchGrating(kit, group, timber); addMooringCleats(kit, group, timber, trim); }
};

export const addExpansionSternShelter = (kit: ShipKit, group: Group,
  roof: ShipMaterialName, posts: ShipMaterialName, rise: number, barrel = false) => {
  const { canopy, floorY } = SHIP_DECK, half = .26, front = -.7, back = -1.07;
  const columns = kit.detailed ? 10 : 4, vertices: number[] = [], uv: number[] = [], indices: number[] = [];
  const height = (x: number) => canopy.roofY + rise * (barrel ? Math.cos(x / half * Math.PI / 2) : 1 - Math.abs(x / half));
  for (let column = 0; column <= columns; column++) {
    const x = -half + column / columns * half * 2;
    for (const z of [back, front]) { vertices.push(x, height(x), z); uv.push(column / columns, z === back ? 0 : 1); }
    if (column < columns) { const a = column * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geometry = kit.temp(new BufferGeometry());
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
  kit.mesh(group, roof, geometry);
  // The shelter floor stands a hair proud of the deck planks so the two surfaces never flicker.
  kit.add(group, posts, [.51, .035, .33], [0, floorY - .0145, -.865]);
  for (const [x, z] of canopy.posts) kit.add(group, posts, [.025, canopy.roofY - floorY, .025],
    [x!, (canopy.roofY + floorY) / 2, z!]);
  for (const z of [back, front]) kit.curve(group, posts,
    Array.from({ length: columns + 1 }, (_, index) => {
      const x = -half + index / columns * half * 2; return [x, height(x) + .005, z];
    }), .008, columns);
  for (const side of [-1, 1]) kit.add(group, posts, [.018, .018, .37],
    [side * .24, canopy.roofY, (back + front) / 2]);
  kit.add(group, posts, [.02, .02, .39], [0, canopy.roofY + rise, (back + front) / 2]);
};

export const addExpansionSteeringOar = (kit: ShipKit, group: Group, side: number, timber: ShipMaterialName) => {
  kit.curve(group, timber, [[side * .24, .4, -.8], [side * .34, .13, -.99], [side * .39, -.12, -1.12]], .013, 4);
  const blade = kit.add(group, timber, [.025, .24, .095], [side * .4, -.15, -1.13]);
  blade.rotation.set(.25, 0, -side * .17);
  kit.add(group, timber, [.05, .05, .05], [side * .24, .33, -.8]);
};
