import { ConeGeometry, type Group, Mesh } from "three";

import { addShipShrouds, romanBeam } from "./roman-ship-hull";
import { addShipDeck, SHIP_DECK_LEVELS } from "./ship-deck-planking";
import {
  bandSections, gunwaleLine, hullBand, hullDeckOutline, type HullForm, hullPoint, hullZ
} from "./ship-hull-loft";
import type { ShipKit } from "./ship-kit";
import { addOarBank, addSteeringOar } from "./viking-ship-hull";

/**
 * The raiders' own galley (owner 2026-10-13), clearly an enemy: a lean pitch-tarred hull with a
 * blood-red wale, painted bow eyes, a bronze ram at the waterline, iron-spiked stakes along the
 * rails, a bank of black oars and a scorpion-tail stern post; the serpent figurehead sits on its
 * stem head and it sets the dark serpent sail. Same deck,
 * slots, footprint and speed as every other ship.
 */
const RAIDER_HULL: HullForm = {
  beam: t => romanBeam(t) * .98,
  depth: t => RAIDER_HULL.sheer(t) + .13 - Math.abs(t - .5) ** 3 * .6,
  section: a => [Math.cos(a * Math.PI / 2) ** 1.3, Math.sin(a * Math.PI / 2) ** .85],
  sheer: t => .212 + Math.abs(t - .5) ** 2.6 * .95
};

const WALE = .1;
const raiderRings = (kit: ShipKit) => kit.detailed ? 19 : 7;
const tarRows = (kit: ShipKit) => kit.detailed ? 5 : 2;

/** Tarred planking under a red wale and a black gunwale rail; High adds two seam lines. */
const addPlanking = (kit: ShipKit, planking: Group) => {
  const rings = raiderRings(kit);
  kit.mesh(planking, "tar", kit.temp(hullBand(RAIDER_HULL, { from: WALE, rings, rows: tarRows(kit), to: 1 })));
  kit.mesh(planking, "trim", kit.temp(hullBand(RAIDER_HULL, { from: 0, rings, rows: 1, to: WALE })));
  for (const side of [-1, 1]) {
    kit.curve(planking, "dark", gunwaleLine(RAIDER_HULL, side, rings, { lift: .006, out: .004 }), .016,
      kit.detailed ? 24 : 8);
    if (kit.detailed) for (const a of [WALE, .45]) kit.curve(planking, "dark",
      gunwaleLine(RAIDER_HULL, side, rings, { a, out: .003 }), .004, 24);
  }
};

/**
 * The serpent (authored on the merchant stem head) moves back onto this galley's more upright stem,
 * keeping the bow inside the shared navigation envelope.
 */
export const RAIDER_FIGUREHEAD_OFFSET = [0, 0, -.16] as const;

/** Stem (carrying the serpent) and the bronze ram at its foot. */
const addBow = (kit: ShipKit, planking: Group) => {
  kit.curve(planking, "tar", [[0, -.08, 1.04], [0, .2, 1.09], [0, .43, 1.22 + RAIDER_FIGUREHEAD_OFFSET[2]]], .035);
  const sides = kit.detailed ? 8 : 4;
  kit.mesh(planking, "bronze", kit.temp(new ConeGeometry(.045, .26, sides).rotateX(Math.PI / 2)
    .translate(0, .03, 1.13)));
  if (!kit.detailed) return;
  // The ram's fins: three bronze blades across its head.
  for (const y of [-.005, .03, .065]) kit.add(planking, "bronze", [.11 - Math.abs(y - .03) * 1.4, .008, .05],
    [0, y, 1.17]);
};

/** A staring eye painted on each bow: a pale disc, a red iris and a black pupil. */
const addBowEyes = (kit: ShipKit, planking: Group) => {
  const t = .88, z = hullZ(t);
  const slope = (RAIDER_HULL.beam(t + .01) - RAIDER_HULL.beam(t - .01)) / (hullZ(t + .01) - hullZ(t - .01));
  for (const side of [-1, 1]) for (const [material, radius, out] of [["deck", .06, .004], ["trim", .038, .007],
    ["tar", .018, .009]] as const) {
    const [x, y] = hullPoint(RAIDER_HULL, t, .32, side, out);
    const eye = new Mesh(kit.medallion, kit.materials[material]);
    eye.scale.set(radius, .003, radius * .7); eye.rotation.set(0, -side * Math.atan(slope), side * Math.PI / 2);
    eye.position.set(x, y, z); planking.add(eye);
  }
};

/** Stakes with iron spikes along both rails (every other stake on Minimal), outboard of the deck. */
const addSpikedStakes = (kit: ShipKit, planking: Group) => {
  const step = kit.detailed ? .12 : .24;
  for (const side of [-1, 1]) for (let z = -.78; z <= .84; z += step) {
    const t = z / 2.2 + .5, [x, y] = hullPoint(RAIDER_HULL, t, 0, side, -.004);
    kit.add(planking, "dark", [.014, .09, .014], [x, y + .045, z]);
    if (kit.detailed) kit.mesh(planking, "iron", kit.temp(new ConeGeometry(.009, .035, 4).translate(x, y + .107, z)));
  }
};

/** Scorpion-tail stern post curling forward to an iron spike, and the steering platform. */
const addStern = (kit: ShipKit, planking: Group, fittings: Group) => {
  const tail = [[0, -.04, -1.0], [0, .3, -1.12], [0, .6, -1.12], [0, .78, -1.02], [0, .8, -.92], [0, .74, -.86]];
  kit.curve(planking, "tar", tail, .03, kit.detailed ? 16 : 6);
  kit.mesh(planking, "iron", kit.temp(new ConeGeometry(.02, .07, kit.detailed ? 6 : 4).rotateX(Math.PI * .8)
    .translate(0, .71, -.84)));
  kit.add(planking, "deck", [.42, .03, .16], [0, .25, -.96]);
  addSteeringOar(kit, fittings);
};

export const buildRaiderHull = (kit: ShipKit, planking: Group, fittings: Group = planking) => {
  addPlanking(kit, planking);
  addShipDeck(kit, planking, hullDeckOutline(RAIDER_HULL, raiderRings(kit),
    [0, ...bandSections(WALE, 1, tarRows(kit))], SHIP_DECK_LEVELS));
  addBow(kit, planking);
  addBowEyes(kit, planking);
  addSpikedStakes(kit, planking);
  addStern(kit, planking, fittings);
  addOarBank(kit, fittings, RAIDER_HULL, "dark");
};

/** Black mast and yard, a fighting top above the yard and (High) the shrouds. */
export const buildRaiderRig = (kit: ShipKit, rig: Group) => {
  const mast = kit.add(rig, "dark", [.03, 2.2, .03], [0, 1.25, 0]); mast.geometry = kit.pole;
  const yard = kit.add(rig, "dark", [.022, 1.38, .022], [0, 1.68, .05]); yard.geometry = kit.pole;
  yard.rotation.z = Math.PI / 2 - .02;
  const top = kit.add(rig, "tar", [.1, .05, .1], [0, 1.95, 0]); top.geometry = kit.medallion;
  if (kit.detailed) addShipShrouds(kit, rig, false);
};
