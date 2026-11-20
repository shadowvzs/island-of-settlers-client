import { type Group, Vector3 } from "three";

import { SHIP_DECK } from "../../../render-common/ships/ship-deck-layout";
import { addExpansionHull, addExpansionSteeringOar,addExpansionSternShelter } from "./expansion-ship-hull-kit";
import { type HullForm,hullPoint } from "./ship-hull-loft";
import type { ShipKit } from "./ship-kit";

/** Half siding of the junk's stem post, onto which the bow planking closes. */
const CHINESE_STEM_SIDING = .022;
/** Share of the hull length (from the bow) over which the forefoot rises and the stem rakes forward. */
const bowShare = (t: number, from: number) => Math.max(0, (t - from) / (1 - from));

/**
 * Chined merchant junk: full stern transom, broad shoulders and a sharp V-sectioned bow whose raked stem
 * cuts the water, under low working bulwarks.
 */
const CHINESE_HULL: HullForm = {
  beam: t => {
    const stern = .25 * Math.max(0, (.25 - t) / .25) ** 2;
    if (t <= .57) return .435 * (1 - stern);
    return CHINESE_STEM_SIDING + (.435 - CHINESE_STEM_SIDING) * (1 - bowShare(t, .57) ** 2.6);
  },
  depth: t => CHINESE_HULL.sheer(t) + .14 - bowShare(t, .82) ** 2 * .13,
  rake: (t, a) => bowShare(t, .8) ** 2 * (1 - Math.min(1, Math.max(0, a))) * .12,
  vee: t => bowShare(t, .66) ** 1.4,
  section: a => a < .65 ? [1 - a * .18, a * 1.15] : [.883 * (1 - (a - .65) / .35), .7475 + (a - .65) / .35 * .2525],
  sheer: t => .225 + Math.max(0, (.18 - t) / .18) ** 2 * .15 + Math.max(0, (t - .82) / .18) ** 2 * .12
};
const PERSIAN_HULL: HullForm = {
  beam: t => Math.max(.026, Math.sin(t * Math.PI) ** .66 * .433),
  depth: t => PERSIAN_HULL.sheer(t) + .17 - Math.abs(t - .5) ** 3 * .5,
  section: a => [Math.cos(a * Math.PI / 2) ** .8, Math.sin(a * Math.PI / 2)],
  sheer: t => .222 + Math.max(0, (t - .78) / .22) ** 2 * .3 + Math.max(0, (.16 - t) / .16) ** 2 * .1,
  rake: (t, a) => Math.max(0, (t - .85) / .15) ** 2 * (1 - a) * .05
};
const MAYA_HULL: HullForm = {
  beam: t => Math.max(.024, Math.sin(t * Math.PI) ** .55 * .429),
  depth: t => MAYA_HULL.sheer(t) + .135,
  section: a => a < 0 ? [1, a] : [1 - a ** 2.6, Math.sin(a * Math.PI / 2)],
  sheer: t => .22 + Math.max(0, (Math.abs(t - .5) - .32) / .18) ** 2 * .17
};
const INDIGENOUS_HULL: HullForm = {
  beam: t => Math.max(.02, Math.sin(t * Math.PI) ** .6 * .431),
  depth: t => INDIGENOUS_HULL.sheer(t) + .14,
  section: a => a < 0 ? [1, a] : [Math.cos(a * Math.PI / 2), Math.sin(a * Math.PI / 2) ** .85],
  sheer: t => .222 + Math.max(0, (Math.abs(t - .5) - .3) / .2) ** 2 * .25
};

/** The outward surface normal of the junk's skin at (t, a) on `side`. */
const skinNormal = (t: number, a: number, side: number) => {
  const along = new Vector3(...hullPoint(CHINESE_HULL, t + .01, a, side))
    .sub(new Vector3(...hullPoint(CHINESE_HULL, t - .01, a, side)));
  const down = new Vector3(...hullPoint(CHINESE_HULL, t, a + .02, side))
    .sub(new Vector3(...hullPoint(CHINESE_HULL, t, a - .02, side)));
  const normal = new Vector3().crossVectors(along, down).normalize();
  return normal.x * side < 0 ? normal.negate() : normal;
};

/** Painted bow eyes (oculi) on both flared bow shoulders, laid on the vermilion strake. */
const addBowEyes = (kit: ShipKit, hull: Group) => {
  const up = new Vector3(0, 1, 0);
  for (const side of [-1, 1]) {
    const centre = new Vector3(...hullPoint(CHINESE_HULL, .905, .04, side)), normal = skinNormal(.905, .04, side);
    for (const [material, radius, proud] of [["paper", .03, .006], ["dark", .014, .008]] as const) {
      const eye = kit.mesh(hull, material, kit.medallion);
      eye.scale.set(radius, .003, radius); eye.quaternion.setFromUnitVectors(up, normal);
      eye.position.copy(centre).addScaledVector(normal, proud);
    }
  }
};

/**
 * The junk's raked stem post: the bow planking closes onto it from the forefoot to a vermilion-capped
 * stem head above the rails, with the anchor windlass on the foredeck, ahead of every deck slot.
 */
const addJunkBow = (kit: ShipKit, hull: Group) => {
  const stem = [1, .7, .4, .1, -.06].map(a => {
    const [, y, z] = hullPoint(CHINESE_HULL, 1, a, 1);
    return [0, y, z + .012];
  });
  const [, headY, headZ] = stem.at(-1)!;
  kit.curve(hull, "teak", [...stem, [0, headY! + .07, headZ! + .028]], .026, kit.detailed ? 10 : 5);
  kit.add(hull, "vermilion", [.06, .028, .06], [0, headY! + .084, headZ! + .033]);
  for (const side of [-1, 1]) kit.add(hull, "teak", [.022, .085, .07], [side * .09, .2475, .955]);
  const drum = kit.add(hull, "teak", [.026, .158, .026], [0, .265, .955]);
  drum.geometry = kit.pole; drum.rotation.z = Math.PI / 2;
  addBowEyes(kit, hull);
  if (!kit.detailed) return;
  for (const angle of [0, Math.PI / 2]) {
    const bar = kit.add(hull, "dark", [.012, .11, .012], [.055, .265, .955]);
    bar.rotation.x = angle; bar.geometry = kit.pole;
  }
};

export const buildChineseShipHull = (kit: ShipKit, hull: Group, fittings: Group = hull) => {
  addExpansionHull(kit, hull, CHINESE_HULL, "teak", "vermilion");
  addJunkBow(kit, hull);
  const { canopy, floorY } = SHIP_DECK;
  addExpansionSternShelter(kit, hull, "lacquer", "vermilion", .12);
  const y = (floorY + canopy.roofY) / 2, height = canopy.roofY - floorY;
  kit.add(hull, "teak", [.46, height, .025], [0, y, -1.01]);
  for (const side of [-1, 1]) {
    kit.add(hull, "teak", [.02, height, .26], [side * .235, y, -.87]);
    kit.add(hull, "paper", [.024, .19, .15], [side * .247, .44, -.86]);
    if (kit.detailed) for (let bar = 0; bar < 4; bar++) kit.add(hull, "vermilion", [.026, .19, .008],
      [side * .25, .44, -.92 + bar * .04]);
    kit.curve(hull, "vermilion", [[side * .26, .62, -.71], [side * .29, .65, -.71],
      [side * .32, .69, -.71]], .009, 4);
  }
  // Stern-mounted balanced rudder below the occupied deck, with a tiller confined to the shelter.
  kit.add(fittings, "teak", [.028, .49, .19], [0, -.04, -1.11]);
  kit.add(fittings, "dark", [.025, .025, .2], [0, .38, -.99]);

};

export const buildPersianShipHull = (kit: ShipKit, hull: Group, fittings: Group = hull) => {
  addExpansionHull(kit, hull, PERSIAN_HULL, "cedar", "indigo");
  addExpansionSternShelter(kit, hull, "hide", "cedar", .11, true);
  addExpansionSteeringOar(kit, fittings, 1, "cedar");
  kit.curve(hull, "cedar", [[0, .34, .99], [0, .49, 1.1], [0, .66, 1.16], [0, .76, 1.17]], .023, 8);
  // Sewn-plank ties are actual paired holes/lashings at the exterior seam, below passenger clearance.
  if (kit.detailed) for (const side of [-1, 1]) for (let index = 1; index < 15; index++) {
    const t = index / 15, [x, y, z] = hullPoint(PERSIAN_HULL, t, .25, side, .005);
    kit.curve(hull, "dark", [[x, y + .025, z - .014], [x + side * .006, y, z],
      [x, y - .025, z + .014]], .003, 3);
  }
  for (const side of [-1, 1]) {
    kit.add(hull, "indigo", [.012, .065, .29], [side * .245, .54, -.87]);
    kit.add(hull, "gold", [.014, .014, .29], [side * .246, .575, -.87]);
  }
};

export const buildMayaShipHull = (kit: ShipKit, hull: Group, fittings: Group = hull) => {
  addExpansionHull(kit, hull, MAYA_HULL, "cedar", "turquoise");
  addExpansionSternShelter(kit, hull, "reed", "cedar", .16);
  addExpansionSteeringOar(kit, fittings, -1, "cedar");
  // A stout stem post closes the narrow bow from the keel to a painted head above the rails.
  kit.curve(hull, "cedar", [[0, -.12, 1.112], [0, .14, 1.13], [0, .4, 1.13], [0, .5, 1.112]], .02,
    kit.detailed ? 8 : 4);
  kit.add(hull, "turquoise", [.046, .03, .046], [0, .5, 1.112]);
  if (!kit.detailed) return;
  for (const side of [-1, 1]) for (let index = 1; index < 10; index++) {
    const t = index / 10, [x, y, z] = hullPoint(MAYA_HULL, t, .23, side, .006);
    kit.add(hull, "turquoise", [.012, .032, .055], [x, y, z]);
    kit.add(hull, "ochre", [.014, .015, .023], [x + side * .002, y + .022, z + .018]);
  }
  // Closely tied palm roof laths follow its gable rather than appearing as loose sticks above it.
  for (let index = 1; index < 8; index++) for (const side of [-1, 1]) kit.curve(hull, "dark",
    [[0, .783, -1.06 + index * .044], [side * .26, .625, -1.06 + index * .044]], .003, 1);
};

export const buildIndigenousShipHull = (kit: ShipKit, hull: Group, fittings: Group = hull) => {
  addExpansionHull(kit, hull, INDIGENOUS_HULL, "bark", "dark");
  addExpansionSternShelter(kit, hull, "hide", "cedar", .15, true);
  addExpansionSteeringOar(kit, fittings, 1, "cedar");
  for (const side of [-1, 1]) {
    kit.curve(hull, "cedar", [[0, .31, side * 1.02], [0, .49, side * 1.1],
      [0, .65, side * 1.14], [0, .69, side * 1.1]], .023, kit.detailed ? 8 : 4);
    if (!kit.detailed) continue;
    for (let index = 1; index < 14; index++) {
      const t = index / 14, [x, y, z] = hullPoint(INDIGENOUS_HULL, t, .18, side, .005);
      kit.curve(hull, "dark", [[x, y + .03, z - .018], [x + side * .007, y, z],
        [x, y - .03, z + .018]], .0035, 3);
    }
  }
  if (!kit.detailed) return;
  for (let index = 1; index < 8; index++) {
    const t = index / 8;
    for (const side of [-1, 1]) {
      const [x, y, z] = hullPoint(INDIGENOUS_HULL, t, .55, side, .003);
      kit.curve(hull, "cedar", [[x * .98, y - .025, z], [x, y, z], [x * .93, y + .035, z]], .006, 3);
    }
  }
};
