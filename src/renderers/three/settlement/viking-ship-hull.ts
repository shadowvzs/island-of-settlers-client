import { type Group, Matrix4, Mesh } from "three";

import { curveThrough, profileTube } from "../sculpt-geometry";
import { addShipShrouds, romanBeam } from "./roman-ship-hull";
import { addShipDeck, SHIP_DECK_LEVELS } from "./ship-deck-planking";
import {
  bandSections, clinkerBands, gunwaleLine, hullBand, hullDeckOutline, type HullForm, hullPoint, hullZ
} from "./ship-hull-loft";
import type { ShipKit } from "./ship-kit";
import type { ShipMaterialName } from "./ship-materials";

/**
 * Clinker-built longship on the shared deck: overlapping strakes, a low waist and high curved ends
 * (the dragon's stem, a curled stern post), oar ports, a shield row along both rails (instanced, see
 * `vikingShieldPlacements`) and a starboard steering oar. Same beam, deck and slots as the Roman
 * merchant hull.
 */
const VIKING_HULL: HullForm = {
  beam: t => romanBeam(t) * 1.03,
  depth: t => VIKING_HULL.sheer(t) + .15 - Math.abs(t - .5) ** 3 * .6,
  section: a => [Math.cos(a * Math.PI / 2), Math.sin(a * Math.PI / 2)],
  sheer: t => .215 + Math.abs(t - .5) ** 2.4 * 1.15
};

/** The dragon and its stem (ship-dragon-figurehead.ts) are moved onto this longship's bow. */
export const VIKING_FIGUREHEAD_OFFSET = [0, .1, -.13] as const;

const SHIELD = { radius: .06, spacing: .11 } as const;

/**
 * Shield row on both rails: the shared Viking round shield (viking-round-shield.ts) hung outboard of
 * the gunwale on the top strake, overlapping a little; one instanced mesh per craft.
 */
export const vikingShieldPlacements = () => {
  const placements: Matrix4[] = [], size = new Matrix4().makeScale(SHIELD.radius * 2, SHIELD.radius * 2,
    SHIELD.radius * 2);
  for (const side of [-1, 1]) for (let z = -.74; z <= .8; z += SHIELD.spacing) {
    const t = z / 2.2 + .5, [x, y] = hullPoint(VIKING_HULL, t, 0, side, .03);
    const slope = (VIKING_HULL.beam(t + .01) - VIKING_HULL.beam(t - .01)) / (hullZ(t + .01) - hullZ(t - .01));
    // The model faces +z; turned to face outboard along the local planking.
    const heading = side > 0 ? Math.PI / 2 + Math.atan(slope) : -Math.PI / 2 - Math.atan(slope);
    placements.push(new Matrix4().makeRotationY(heading).setPosition(x, y + .004, z).multiply(size));
  }
  return placements;
};

/**
 * A bank of oars run out through ports in the second strake (below the longship's shields); High
 * shows the ports as dark discs. Shared with the raider galley.
 */
export const addOarBank = (kit: ShipKit, planking: Group, form: HullForm, oar: ShipMaterialName) => {
  for (const side of [-1, 1]) for (let z = -.62; z <= .7; z += SHIELD.spacing * 2) {
    const t = z / 2.2 + .5, [x, y] = hullPoint(form, t, .2, side, .006);
    if (kit.detailed) {
      const port = kit.add(planking, "dark", [.022, .004, .022], [x, y, z]);
      port.geometry = kit.medallion; port.rotation.z = Math.PI / 2;
    }
    // An oar run out of each port below the shields, its blade down by the waterline.
    const tip = [side * .66, -.16, z - .05];
    kit.curve(planking, oar, [[x - side * .03, y + .01, z], tip], .007, 1);
    const blade = kit.add(planking, oar, [.008, .09, .03], [tip[0]!, tip[1]! - .03, tip[2]!]);
    blade.rotation.z = side * .5;
  }
};

/**
 * The stern post curls inboard. The stem is part of the dragon carving (ship-dragon-figurehead.ts), one
 * timber from the keel to the head, so the neck grows out of it without a joint.
 */
const addSternPost = (kit: ShipKit, planking: Group) => {
  const sides = kit.detailed ? 8 : 4;
  kit.mesh(planking, "dark", kit.temp(profileTube(curveThrough([[0, -.1, -.95], [0, .08, -1.08], [0, .32, -1.13],
    [0, .55, -1.12], [0, .72, -1.06], [0, .8, -.98], [0, .79, -.92], [0, .74, -.9]]), t => .032 - t * .02,
  kit.detailed ? 16 : 6, sides)));
};

/** Starboard steering oar on its boss, with the tiller reaching inboard (also the raider galley's). */
export const addSteeringOar = (kit: ShipKit, planking: Group) => {
  kit.curve(planking, "dark", [[.36, .5, -.84], [.43, .14, -.93], [.48, -.16, -1.0]], .016, 4);
  const blade = kit.add(planking, "wood", [.03, .26, .09], [.48, -.2, -1.0]);
  blade.rotation.set(.25, 0, .18);
  kit.curve(planking, "wood", [[.36, .5, -.84], [.24, .52, -.82], [.14, .5, -.8]], .009, 3);
  kit.add(planking, "dark", [.05, .06, .07], [.34, .4, -.84]);
};

/** Clinker strakes between the sheer strake and the bottom, each lapped over the next. */
const STRAKES = { from: .1, lap: .013, to: 1 } as const;

const plankingLayout = (kit: ShipKit) => ({ rings: kit.detailed ? 19 : 7, rows: kit.detailed ? 2 : 1,
  strakes: kit.detailed ? 7 : 3 });

/**
 * The deck closes onto the dark sheer strake and, towards the high ends, onto the strakes below it
 * (their laps stand outboard of the loft, so the unlapped rows stay inside the skin).
 */
const vikingDeckOutline = (kit: ShipKit) => {
  const { rings, rows, strakes } = plankingLayout(kit), { from, to } = STRAKES;
  const sections = [...bandSections(0, .115, rows), ...bandSections(from, to, strakes).filter(a => a > .115)];
  return hullDeckOutline(VIKING_HULL, rings, sections, SHIP_DECK_LEVELS);
};

/** Clinker strakes (each lapped over the next) under a dark sheer strake and gunwale; High marks the laps. */
const addPlanking = (kit: ShipKit, planking: Group) => {
  const { rings, rows, strakes } = plankingLayout(kit);
  const { from, lap, to } = STRAKES;
  for (const band of clinkerBands(VIKING_HULL, strakes, { from, rings, rows, to }, lap)) kit.mesh(planking, "wood",
    kit.temp(band));
  kit.mesh(planking, "dark", kit.temp(hullBand(VIKING_HULL, { from: 0, rings, rows, to: .115 })));
  for (const side of [-1, 1]) {
    kit.curve(planking, "dark", gunwaleLine(VIKING_HULL, side, rings, { lift: .006, out: .004 }), .016,
      kit.detailed ? 24 : 8);
    // The riveted land of each strake: a dark line where it laps over the one below.
    if (kit.detailed) for (let strake = 1; strake < strakes; strake++) kit.curve(planking, "dark",
      gunwaleLine(VIKING_HULL, side, rings, { a: from + (to - from) * strake / strakes, out: lap * .15 + .002 }),
    .0035, 24);
  }
};

/** Steering platform aft with a sea chest and a coiled rope, clear of the deck slots (High). */
const addSternFittings = (kit: ShipKit, planking: Group) => {
  kit.add(planking, "deck", [.42, .03, .16], [0, .25, -.96]);
  kit.add(planking, "wood", [.13, .08, .07], [-.15, .305, -.96]);
  for (const x of [-.2, -.1]) kit.add(planking, "dark", [.008, .084, .074], [x, .305, -.96]);
  const coil = new Mesh(kit.coinRing, kit.materials.dark);
  coil.scale.set(.045, .045, .02); coil.rotation.x = Math.PI / 2; coil.position.set(.13, .275, -.97); planking.add(coil);
};

/**
 * The longship hull: clinker strakes, deck, oar ports, stern post, mast fish and steering oar (the stem
 * is the dragon's).
 */
export const buildVikingHull = (kit: ShipKit, planking: Group, fittings: Group = planking) => {
  addPlanking(kit, planking);
  addShipDeck(kit, planking, vikingDeckOutline(kit));
  addSternPost(kit, planking);
  addSteeringOar(kit, fittings);
  addOarBank(kit, fittings, VIKING_HULL, "wood");
  // The mast fish (kerling) on the keelson, inside the hatch area.
  kit.add(planking, "dark", [.07, .05, .3], [0, .23, -.13]);
  if (kit.detailed) addSternFittings(kit, planking);
};

/** Mast, square-sail yard and (High) the shrouds, as on the merchant ship. */
export const buildVikingRig = (kit: ShipKit, rig: Group) => {
  const mast = kit.add(rig, "dark", [.03, 2.2, .03], [0, 1.25, 0]); mast.geometry = kit.pole;
  const yard = kit.add(rig, "dark", [1.38, .04, .04], [0, 1.68, .05]); yard.geometry = kit.pole;
  yard.scale.set(.022, 1.38, .022); yard.rotation.z = Math.PI / 2 - .02;
  if (kit.detailed) addShipShrouds(kit, rig, false);
};
