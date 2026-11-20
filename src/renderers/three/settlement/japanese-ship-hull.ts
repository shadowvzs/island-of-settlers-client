import { BufferGeometry, Float32BufferAttribute, Group, Mesh } from "three";

import { SHIP_DECK } from "../../../render-common/ships/ship-deck-layout";
import { addJapaneseDetails } from "./japanese-ship-details";
import { addJapaneseStem, stemRake } from "./japanese-ship-stem";
import { addShipShrouds } from "./roman-ship-hull";
import { addShipDeck, SHIP_DECK_LEVELS } from "./ship-deck-planking";
import {
  bandSections, gunwaleLine, hullBand, hullDeckOutline, hullEndCap, type HullForm, hullPoint
} from "./ship-hull-loft";
import type { ShipKit } from "./ship-kit";
import { BATTENED_SAIL, battenedSailDepth } from "./ship-sails";

const CHINE = .6;
/** Half siding of the stem timber the bow planking closes onto. */
const STEM_HALF_SIDING = .022;
/** The bulwark rises this far (in section units) above the gunwale. */
const BULWARK = -.22;

/**
 * Bune-style coaster on the shared deck: a flat-bottomed, slab-sided hull with a wide transom, a curved
 * raked stem, black lacquered bulwarks with vermilion rails, a two-roofed deck house (yagura) aft
 * and a great stern rudder. Same deck, slots and footprint as the Roman merchant hull.
 */
const JAPANESE_HULL: HullForm = {
  beam: t => {
    if (t > .55) return STEM_HALF_SIDING + (.44 - STEM_HALF_SIDING) * (1 - ((t - .55) / .45) ** 3);
    return .44 * (1 - .32 * ((.55 - t) / .55) ** 2.5);
  },
  depth: t => JAPANESE_HULL.sheer(t) + .08 - Math.max(0, t - .82) ** 2 * 4 - Math.max(0, .1 - t) ** 2 * 6,
  rake: stemRake(BULWARK),
  section: a => {
    if (a < 0) return [1, a * .75 / CHINE];
    if (a < CHINE) return [1 - a / CHINE * .14, a / CHINE * .75];
    const k = (a - CHINE) / (1 - CHINE);
    return [.86 * (1 - k), .75 + k * .25];
  },
  sheer: t => .215 + Math.max(0, t - .62) ** 2 * 1.6 + Math.max(0, .25 - t) ** 2 * 1.4
};

/** A flat polygon (fan from the first point), facing +y. */
const fan = (points: readonly (readonly number[])[]) => {
  const geometry = new BufferGeometry(), indices: number[] = [];
  for (let i = 1; i < points.length - 1; i++) indices.push(0, i + 1, i);
  geometry.setAttribute("position", new Float32BufferAttribute(points.flat(), 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(points.flatMap(point => [point[0]! * 2, point[2]! * 2]), 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
};

const hullLayout = (kit: ShipKit) => ({ rings: kit.detailed ? 19 : 7, rows: kit.detailed ? 3 : 1 });

/** The deck reaches the lacquered bulwark and, into the raked bow, the planking below it. */
const japaneseDeckOutline = (kit: ShipKit) => {
  const { rings, rows } = hullLayout(kit);
  const sections = [...bandSections(BULWARK, .3, rows), ...bandSections(.3, 1, rows + 1).slice(1)];
  return hullDeckOutline(JAPANESE_HULL, rings, sections, SHIP_DECK_LEVELS);
};

/** Hull, transom, bulwarks, rails, curved stem, bow crests and the stern rudder. */
const addHull = (kit: ShipKit, planking: Group) => {
  const { rings, rows } = hullLayout(kit);
  kit.mesh(planking, "wood", kit.temp(hullBand(JAPANESE_HULL, { from: .3, rings, rows: rows + 1, to: 1 })));
  kit.mesh(planking, "lacquer", kit.temp(hullBand(JAPANESE_HULL, { from: BULWARK, rings, rows, to: .3 })));
  kit.mesh(planking, "lacquer", kit.temp(hullEndCap(JAPANESE_HULL, 0, rows + 2, -1)));
  for (const side of [-1, 1]) {
    kit.curve(planking, "vermilion", gunwaleLine(JAPANESE_HULL, side, rings, { a: BULWARK, lift: .008, out: .006 }),
      .014, kit.detailed ? 24 : 8);
    if (kit.detailed) kit.curve(planking, "vermilion", gunwaleLine(JAPANESE_HULL, side, rings, { a: .3, out: .004 }),
      .006, 24);
  }
  addJapaneseStem(kit, planking, JAPANESE_HULL, BULWARK);
  if (kit.detailed) for (const side of [-1, 1]) {
    const [x, y, z] = hullPoint(JAPANESE_HULL, .86, .1, side, .008);
    const crest = new Mesh(kit.medallion, kit.materials.gold); crest.scale.set(.045, .006, .045);
    crest.rotation.z = Math.PI / 2; crest.position.set(x, y, z); planking.add(crest);
  }
  // Stern rudder hung on the transom, its tiller into the deck house.
  kit.curve(planking, "lacquer", [[0, .52, -1.04], [0, .2, -1.1], [0, -.05, -1.12]], .02, 4);
  kit.add(planking, "wood", [.025, .3, .15], [0, -.05, -1.17]);
  kit.add(planking, "lacquer", [.02, .02, .2], [0, .5, -.97]);
};

const HOUSE = {
  back: -1.06, eave: .63, front: -.86, halfWidth: .245, ridge: .8, roofBack: -1.12, roofFront: -.68
} as const;

/** Paper walls between lacquered posts: side walls, back wall and a front with a curtained doorway. */
const addHouseWalls = (kit: ShipKit, planking: Group) => {
  const { add, detailed } = kit, height = HOUSE.eave - SHIP_DECK.floorY - .03, y = SHIP_DECK.floorY + height / 2;
  const depth = HOUSE.front - HOUSE.back, middle = (HOUSE.front + HOUSE.back) / 2;
  add(planking, "deck", [HOUSE.halfWidth * 2, .03, depth], [0, SHIP_DECK.floorY, middle]);
  for (const side of [-1, 1]) {
    add(planking, "paper", [.01, height, depth], [side * HOUSE.halfWidth, y, middle]);
    add(planking, "paper", [.17, height, .01], [side * .16, y, HOUSE.front]);
  }
  add(planking, "paper", [HOUSE.halfWidth * 2, height, .01], [0, y, HOUSE.back]);
  add(planking, "vermilion", [.15, .12, .006], [0, HOUSE.eave - .1, HOUSE.front - .002]);
  for (const [x, z] of [...SHIP_DECK.canopy.posts, [-HOUSE.halfWidth, HOUSE.front], [HOUSE.halfWidth, HOUSE.front],
    [-HOUSE.halfWidth, HOUSE.back], [HOUSE.halfWidth, HOUSE.back], [-.075, HOUSE.front], [.075, HOUSE.front]])
    add(planking, "lacquer", [.026, HOUSE.eave - SHIP_DECK.floorY, .026], [x!, (HOUSE.eave + SHIP_DECK.floorY) / 2, z!]);
  add(planking, "lacquer", [HOUSE.halfWidth * 2 + .03, .03, .03], [0, HOUSE.eave - .02, HOUSE.front]);
  add(planking, "lacquer", [HOUSE.halfWidth * 2 + .03, .03, .03], [0, HOUSE.eave - .02, SHIP_DECK.canopy.minZ]);
  if (!detailed) return;
  // Shoji lattice over the paper.
  for (const side of [-1, 1]) {
    for (let bar = 1; bar < 4; bar++) add(planking, "lacquer", [.008, height, .008],
      [side * (HOUSE.halfWidth + .006), y, HOUSE.front - bar * depth / 4]);
    for (const level of [.3, .62]) add(planking, "lacquer", [.008, .008, depth],
      [side * (HOUSE.halfWidth + .006), SHIP_DECK.floorY + height * level, middle]);
  }
};

/** Gabled roof boards with a raised ridge and gilt ridge ends over the house and its front veranda. */
const addHouseRoof = (kit: ShipKit, planking: Group) => {
  const length = HOUSE.roofFront - HOUSE.roofBack, middle = (HOUSE.roofFront + HOUSE.roofBack) / 2;
  const run = HOUSE.halfWidth + .07, rise = HOUSE.ridge - HOUSE.eave, slope = Math.hypot(run, rise);
  for (const side of [-1, 1]) {
    const board = kit.add(planking, "lacquer", [slope + .02, .022, length], [side * run / 2, HOUSE.eave + rise / 2, middle]);
    board.rotation.z = -side * Math.atan2(rise, run);
  }
  kit.add(planking, "dark", [.05, .04, length + .04], [0, HOUSE.ridge + .015, middle]);
  // Gable ends: each triangle faces outwards (towards the bow in front, the stern behind).
  for (const z of [HOUSE.roofFront + .01, HOUSE.roofBack - .01]) {
    kit.add(planking, "gold", [.03, .07, .03], [0, HOUSE.ridge + .04, z]);
    const gable = [[-run, HOUSE.eave, z], [0, HOUSE.ridge, z], [run, HOUSE.eave, z]];
    kit.mesh(planking, "lacquer", kit.temp(fan(z > middle ? gable : gable.reverse())));
  }
};

export const buildJapaneseHull = (kit: ShipKit, planking: Group, fittings: Group = planking) => {
  addHull(kit, planking);
  addShipDeck(kit, planking, japaneseDeckOutline(kit));
  addHouseWalls(kit, planking);
  addHouseRoof(kit, planking);
  addJapaneseDetails(kit, planking, JAPANESE_HULL, { eave: HOUSE.eave, from: HOUSE.roofBack, ridge: HOUSE.ridge,
    run: HOUSE.halfWidth + .07, to: HOUSE.roofFront }, fittings);
};

/** Lacquered mast, bamboo yard and the battens across the stiff sail; shrouds as on the merchant ship. */
export const buildJapaneseRig = (kit: ShipKit, rig: Group) => {
  const mast = kit.add(rig, "lacquer", [.032, 2.2, .032], [0, 1.25, 0]); mast.geometry = kit.pole;
  const top = BATTENED_SAIL.bottom + BATTENED_SAIL.height;
  const battens = kit.detailed ? BATTENED_SAIL.battens : 3;
  for (let batten = 0; batten <= battens; batten++) {
    const y = BATTENED_SAIL.bottom + batten / battens * BATTENED_SAIL.height, z = battenedSailDepth(y) + .008;
    const radius = batten === battens ? .02 : .008;
    const bar = kit.add(rig, batten === battens ? "wood" : "dark", [radius, BATTENED_SAIL.width + .08, radius],
      [0, y, z]);
    bar.geometry = kit.pole; bar.rotation.z = Math.PI / 2;
  }
  kit.add(rig, "dark", [.04, .05, .05], [0, top, .03]);
  if (kit.detailed) addShipShrouds(kit, rig, false);
};
