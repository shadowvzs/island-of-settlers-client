import { BufferGeometry, CylinderGeometry, Float32BufferAttribute, Group, Quaternion, Vector3 } from "three";

import { SHIP_DECK } from "../../../render-common/ships/ship-deck-layout";
import { curveThrough, profileTube, type SculptPoint } from "../sculpt-geometry";
import { addNubianDetails, addNubianMastBands } from "./nubian-ship-details";
import { romanBeam } from "./roman-ship-hull";
import { addShipDeck, SHIP_DECK_LEVELS } from "./ship-deck-planking";
import { bandSections, gunwaleLine, hullBand, hullDeckOutline, type HullForm } from "./ship-hull-loft";
import type { ShipKit } from "./ship-kit";
import { LATEEN_SAIL } from "./ship-sails";

/**
 * Nile / Red Sea trader on the shared deck: a round-bilged plank hull whose ends sweep up into lashed
 * papyrus-bundle finials with flaring umbels, painted ochre and indigo bands, a woven palm-leaf
 * awning aft, twin quarter steering oars and a lateen rig. Same deck, slots and footprint as the
 * Roman merchant hull.
 */
const NUBIAN_HULL: HullForm = {
  beam: t => romanBeam(t) * 1.03,
  depth: t => NUBIAN_HULL.sheer(t) + .15 - Math.abs(t - .5) ** 3 * .6,
  section: a => [Math.cos(a * Math.PI / 2), Math.sin(a * Math.PI / 2)],
  sheer: t => .215 + Math.abs(t - .5) ** 2.2 * 1.25
};

/** Painted bands from the gunwale down: indigo, ochre, a thin indigo line, then oiled planking. */
const BANDS = [["indigo", 0, .07], ["ochre", .07, .17], ["indigo", .17, .21], ["wood", .21, 1]] as const;

/** A +Y cylinder turned to start at the origin and run along `direction`. */
const orientAlong = (geometry: BufferGeometry, direction: Vector3) => {
  geometry.computeBoundingBox();
  geometry.translate(0, -geometry.boundingBox!.min.y, 0);
  return geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize()));
};

/** A papyrus-bundle end post along `path`, its umbel flaring at the tip, with lashings (High). */
const papyrusFinial = (kit: ShipKit, planking: Group, path: readonly SculptPoint[]) => {
  const curve = curveThrough(path), sides = kit.detailed ? 8 : 5;
  kit.mesh(planking, "ochre", kit.temp(profileTube(curve, t => .046 - t * .02, kit.detailed ? 14 : 5, sides)));
  const tip = curve.getPointAt(1);
  kit.mesh(planking, "ochre", kit.temp(orientAlong(new CylinderGeometry(.062, .024, .09, sides, 1, true),
    curve.getTangentAt(1)).translate(tip.x, tip.y, tip.z)));
  if (!kit.detailed) return;
  for (const t of [.25, .45, .62, .78, .9]) {
    const tangent = curve.getTangentAt(t), start = curve.getPointAt(t).addScaledVector(tangent, -.006);
    const radius = .049 - t * .02;
    kit.mesh(planking, "indigo", kit.temp(orientAlong(new CylinderGeometry(radius, radius, .012, sides, 1, true),
      tangent).translate(start.x, start.y, start.z)));
  }
};

/** Barrel-vaulted woven awning on four poles over the stern (the shared canopy footprint). */
const addAwning = (kit: ShipKit, planking: Group) => {
  const { canopy, floorY } = SHIP_DECK, columns = kit.detailed ? 8 : 3, half = canopy.maxX + .03;
  const front = canopy.maxZ + .02, back = canopy.minZ - .03, positions: number[] = [], uvs: number[] = [];
  const indices: number[] = [];
  for (let column = 0; column <= columns; column++) for (const [row, z] of [[0, back], [1, front]] as const) {
    const x = -half + column / columns * half * 2, y = canopy.roofY + .075 * Math.cos(x / half * Math.PI / 2);
    positions.push(x, y, z); uvs.push(column / columns * 3, row * 2);
    if (column < columns && row === 0) { const a = column * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const mat = kit.temp(new BufferGeometry());
  mat.setAttribute("position", new Float32BufferAttribute(positions, 3));
  mat.setAttribute("uv", new Float32BufferAttribute(uvs, 2)); mat.setIndex(indices); mat.computeVertexNormals();
  kit.mesh(planking, "reed", mat);
  for (const [x, z] of canopy.posts) kit.add(planking, "wood", [.022, canopy.roofY - floorY + .01, .022],
    [x!, (canopy.roofY + floorY) / 2, z!]);
  for (const z of [front, back]) kit.curve(planking, "wood", Array.from({ length: columns + 1 }, (_, column) => {
    const x = -half + column / columns * half * 2;
    return [x, canopy.roofY + .075 * Math.cos(x / half * Math.PI / 2) + .006, z];
  }), .008, columns * 2);
  kit.add(planking, "wood", [.016, .016, front - back], [0, canopy.roofY + .082, (front + back) / 2]);
};

/** Twin quarter steering oars, as on Nile boats. */
const addQuarterRudders = (kit: ShipKit, planking: Group) => {
  for (const side of [-1, 1]) {
    kit.curve(planking, "dark", [[side * .25, .5, -.8], [side * .33, .2, -.93], [side * .4, -.1, -1.06]], .014, 4);
    const blade = kit.add(planking, "wood", [.025, .22, .08], [side * .41, -.15, -1.08]);
    blade.rotation.set(.35, 0, -side * .2);
    kit.add(planking, "dark", [.04, .04, .05], [side * .25, .42, -.8]);
  }
};

export const buildNubianHull = (kit: ShipKit, planking: Group, fittings: Group = planking) => {
  const rings = kit.detailed ? 19 : 7, sections = [0];
  for (const [material, from, to] of BANDS) {
    let rows = 1;
    if (to - from > .5) rows = kit.detailed ? 5 : 2;
    kit.mesh(planking, material, kit.temp(hullBand(NUBIAN_HULL, { from, rings, rows, to })));
    sections.push(...bandSections(from, to, rows).slice(1));
  }
  for (const side of [-1, 1]) kit.curve(planking, "wood", gunwaleLine(NUBIAN_HULL, side, rings, { lift: .006, out: .004 }),
    .015, kit.detailed ? 24 : 8);
  addShipDeck(kit, planking, hullDeckOutline(NUBIAN_HULL, rings, sections, SHIP_DECK_LEVELS));
  papyrusFinial(kit, planking, [[0, .28, 1.03], [0, .44, 1.1], [0, .62, 1.16], [0, .79, 1.16], [0, .9, 1.1],
    [0, .95, 1.03]]);
  papyrusFinial(kit, planking, [[0, .28, -1.03], [0, .48, -1.12], [0, .72, -1.17], [0, .93, -1.15], [0, 1.04, -1.07],
    [0, 1.08, -.99]]);
  addAwning(kit, planking);
  addQuarterRudders(kit, fittings);
  const [, ochre] = BANDS;
  addNubianDetails(kit, planking, NUBIAN_HULL, { edges: BANDS.slice(1).map(([, from]) => from),
    ochre: (ochre[1] + ochre[2]) / 2 });
};

const yardPoint = (k: number) => LATEEN_SAIL.tack.map((value, axis) => value + (LATEEN_SAIL.peak[axis]! - value) * k);

/** Mast, the long slanted lateen yard and its halyard, forestay, tack line and sheet (all clear above the deck). */
export const buildNubianRig = (kit: ShipKit, rig: Group) => {
  const mast = kit.add(rig, "dark", [.03, 2.2, .03], [0, 1.25, 0]); mast.geometry = kit.pole;
  addNubianMastBands(kit, rig);
  kit.curve(rig, "dark", [yardPoint(-.05), yardPoint(.5), yardPoint(1.05)], .018, kit.detailed ? 8 : 3);
  const crossing = yardPoint(LATEEN_SAIL.tack[2] / (LATEEN_SAIL.tack[2] - LATEEN_SAIL.peak[2]));
  kit.curve(rig, "dark", [[0, 2.3, 0], crossing], .005, 2);
  if (!kit.detailed) return;
  kit.curve(rig, "dark", [[0, 2.32, 0], [0, .62, 1.08]], .004, 2);
  kit.curve(rig, "dark", [LATEEN_SAIL.tack, [0, .58, 1.06]], .004, 2);
  kit.curve(rig, "dark", [LATEEN_SAIL.clew, [.24, .64, -.72]], .004, 2);
};

