import { DMath } from "../../shared/math/deterministic-math";
import { HARBOUR_TOWER_POSITION } from "./harbour-tower-clearance";
import { romanBarrel, romanCanopy, type RomanDesignContext,romanRoom } from "./roman-design-kit";

/** Original circular shore lantern, expressed in authored building units after ground alignment. */
export const ROMAN_HARBOR_BEACON_POSITION = HARBOUR_TOWER_POSITION;

/**
 * Six coursed rings of the beacon tower: the shared fix from `28b15cfab`. Each course's foot
 * flares past the course below and its blocks run a little taller than the course pitch, so the
 * dark underside overlaps the sunlit top of the lower ring: the stacked courses meet with no
 * bright annular gap. The top of every course is normalised to one diameter (the authored taper),
 * so the tower keeps its height and profile.
 */
const BEACON_COURSE = {
  base: .18, blocks: 12, flare: .002, height: .352, pitch: .34, relief: .016, rows: 6, step: .018,
  topDiameter: .86
} as const;

/** Authored diameter at the top of a course and at the flared foot of the next one. */
const courseTop = (row: number) => BEACON_COURSE.topDiameter - row * BEACON_COURSE.step;
const courseFoot = (row: number) => row === 0 ? courseTop(row) : courseTop(row - 1) + BEACON_COURSE.flare;

const addHarborTower = ({ detailed, part, parts }: RomanDesignContext) => {
  const x = -1.04, z = -.18;
  if (detailed) {
    for (let row = 0; row < BEACON_COURSE.rows; row++) {
      const top = courseTop(row), foot = courseFoot(row);
      for (let block = 0; block < BEACON_COURSE.blocks; block++) {
        const angle = (block + (row % 2) * .5) * Math.PI * 2 / BEACON_COURSE.blocks;
        const variation = ((row * 13 + block * 7) % 9) / 9;
        const bottom = foot + variation * BEACON_COURSE.relief, taper = top / bottom;
        part("stone", [x, BEACON_COURSE.base + (row + .5) * BEACON_COURSE.pitch, z],
          [bottom, BEACON_COURSE.height, bottom], 1,
          "stone-arc", [0, angle, 0], [.94 + variation * .06, .95 + variation * .05, .96 + variation * .04]);
        const course = parts[parts.length - 1]!;
        course.innerRadius = .35;
        course.topScale = [taper, 1, taper];
      }
    }
  } else {
    part("stone", [x, 1.2, z], [.84, 2.04, .84], 1, "ring");
    parts[parts.length - 1]!.topScale = [.89, 1, .89];
    for (const y of [.86, 1.54]) part("stone", [x, y, z], [.82, .035, .82], 2, "ring");
  }
  part("stone", [x, 2.255, z], [.92, .10, .92], 2, "cylinder");
  part("stone", [x, 2.33, z], [.86, .055, .86], 2, "cylinder");
  for (let column = 0; column < (detailed ? 8 : 6); column++) {
    const angle = column * Math.PI * 2 / (detailed ? 8 : 6);
    part("stone", [x + DMath.sin(angle) * .34, 2.58, z + DMath.cos(angle) * .34],
      [.045, .46, .045], 2, "cylinder");
    if (detailed) part("gold", [x + DMath.sin(angle) * .34, 2.8, z + DMath.cos(angle) * .34],
      [.055, .035, .055], 3, "cylinder");
  }
  part("stone", [x, 2.845, z], [.93, .075, .93], 2, "cylinder");
  part("roof", [x, 3.03, z], [1.0, .32, 1.0], 4, "cone");
  // Stepped terracotta courses break the conical roof's flat silhouette.
  if (detailed) for (let course = 0; course < 3; course++) {
    const diameter = .95 - course * .255;
    part("roof", [x, 2.9 + course * .085, z], [diameter, .025, diameter], 4, "ring");
  }
  part("gold", [x, 3.21, z], [.1, .08, .1], 4, "sphere");
  // Narrow recessed observation windows. Access to the lantern stays inside the attached warehouse.
  for (const y of [1.45, 1.94]) {
    part("dark", [x, y, z + .403 - (y > 1.8 ? .026 : 0)], [.105, .24, .012], 3, "window-shadow");
    if (detailed) part("stone", [x, y - .135, z + .4], [.16, .035, .055], 3);
  }
};

const addHarborCargo = ({ detailed, part }: RomanDesignContext) => {
  for (let index = 0; index < 2; index++) {
    const x = .8 + index * .42, z = -.21;
    part("wood", [x, .38, z], [.35, .4, .36], 3);
    for (const y of [.24, .53]) part("iron", [x, y, z + .188], [.34, .025, .018], 3);
    if (detailed) {
      for (const side of [-1, 1]) part("wood", [x + side * .14, .38, z + .19], [.032, .39, .025], 3);
      part("wood", [x, .38, z + .2], [.025, .43, .025], 3, "box", [0, 0, -.6]);
      for (const slot of [-1, 0, 1]) part("wood", [x + slot * .095, .586, z], [.085, .016, .34], 3);
    }
  }
  romanBarrel(part, 1.03, .3, detailed, .14);
  if (detailed) romanBarrel(part, .64, -.48, true, .13);
};

/** Broad low shore warehouse and a rounded Roman lantern; cargo remains beside the door lane. */
export const addRomanHarbor = (context: RomanDesignContext) => {
  const { detailed, part } = context;
  romanRoom(context, -.4, 0, 1.9, .95, 1.1, -.4);
  romanCanopy(context, 1.05, -.02, 1.0, 1.05, .98);
  for (const x of [.63, 1.47]) for (const z of [-.44, .4]) {
    part("stone", [x, .235, z], [.16, .11, .16], 2);
    part("stone", [x, 1.13, z], [.18, .085, .18], 2);
  }
  addHarborTower(context);
  addHarborCargo(context);
  if (detailed) {
    // Mooring bollard with a rope coil grounded in the loading yard; never in the entrance.
    part("stone", [1.48, .3, .78], [.16, .24, .16], 2, "cylinder");
    part("rope", [1.48, .24, .78], [.28, .042, .28], 3, "ring");
  }
};
