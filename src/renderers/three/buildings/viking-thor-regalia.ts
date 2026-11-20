import { BoxGeometry, CylinderGeometry, SphereGeometry, TorusGeometry, type Vector3 } from "three";

import {
  createColouredSculpt, curveThrough, ellipsoid, loftGeometry, profileTube,   type SculptColor, type SculptPoint, type SculptRing,
taperedTube} from "../sculpt-geometry";
import { THOR_ATLAS } from "./viking-statue-textures";

/** Cast bronze tones (display colours): polished skin, mail, dark leather, gilt fittings, the oak haft. */
export const BRONZE = {
  cast: [.66, .46, .25], cloak: [.52, .33, .17], dark: [.36, .23, .12], eye: [.16, .1, .06], gilt: [.95, .76, .34],
  hair: [.6, .39, .19], leather: [.44, .28, .14], mail: [.6, .44, .25], skin: [.76, .54, .32],
  wood: [.4, .24, .11]
} as const satisfies Record<string, SculptColor>;

export type Sculpt = ReturnType<typeof createColouredSculpt>;
export type Paint = SculptColor | ((point: Vector3) => SculptColor);
export interface ThorDetail { detailed: boolean; limb: number; round: number; segments: number; torso: number }

/** Where the raised right fist closes round Mjölnir's haft (the figure faces +z, its right is -x). */
export const HAMMER_GRIP: SculptPoint = [-.14, 1, .055];
/** Upright haft: its butt and pommel just below the fist, the head on its top end. */
const HAFT = { above: .29, below: .055, radius: .018 } as const;
const HAMMER_HEAD = { depth: .115, height: .125, width: .21 } as const;

/** Mjölnir's head: a heavy squared block carved with knotwork between gilt end bands. */
const hammerHead = (sculpt: Sculpt, detail: ThorDetail, y: number) => {
  const [x, , z] = HAMMER_GRIP, { depth, height, width } = HAMMER_HEAD;
  sculpt.add(new BoxGeometry(width, height, depth).translate(x, y, z), BRONZE.cast, THOR_ATLAS.knot);
  for (const side of [-1, 1]) sculpt.add(new BoxGeometry(.03, height + .012, depth + .012)
    .translate(x + side * (width / 2 + .015), y, z), BRONZE.gilt);
  if (!detail.detailed) return;
  for (const side of [-1, 1]) sculpt.add(new BoxGeometry(.012, height - .006, depth - .006)
    .translate(x + side * (width / 2 + .036), y, z), BRONZE.gilt);
  // The haft's wedged end shows through the top of the head.
  sculpt.add(new CylinderGeometry(HAFT.radius + .004, HAFT.radius + .004, .006, 10).translate(x, y + height / 2, z),
    BRONZE.wood);
};

/**
 * Mjölnir: a long wooden haft (grain along it, a leather wrap round the grip, a bronze collar under
 * the head), a gilt pommel with a wrist-strap loop under the fist, and the knotwork head on top.
 */
export const mjolnir = (sculpt: Sculpt, detail: ThorDetail) => {
  const [x, y, z] = HAMMER_GRIP, sides = detail.detailed ? 10 : 4, butt = y - HAFT.below, top = y + HAFT.above;
  sculpt.add(new CylinderGeometry(HAFT.radius * .9, HAFT.radius, top - butt, sides, 1, true)
    .translate(x, (top + butt) / 2, z), BRONZE.wood, detail.detailed ? THOR_ATLAS.strands : undefined);
  hammerHead(sculpt, detail, top + HAMMER_HEAD.height / 2);
  if (!detail.detailed) return;
  sculpt.add(new CylinderGeometry(HAFT.radius + .003, HAFT.radius + .003, .1, sides, 1, true)
    .translate(x, y + .02, z), BRONZE.leather, THOR_ATLAS.knot);
  sculpt.add(new CylinderGeometry(HAFT.radius + .004, HAFT.radius + .006, .022, sides).translate(x, top - .011, z),
    BRONZE.gilt);
  sculpt.add(ellipsoid(detail.round, [.023, .019, .023], [x, butt - .008, z]), BRONZE.gilt);
  sculpt.add(new TorusGeometry(.028, .0045, 4, 14).rotateY(.4).translate(x - .01, butt - .04, z + .01),
    BRONZE.leather);
};

/** Spangenhelm with a knotwork brow band, crest, nasal and swept gilt wings of layered feathers. */
const helmet = (sculpt: Sculpt, detail: ThorDetail) => {
  const centre: SculptPoint = [0, .842, .006];
  sculpt.add(new SphereGeometry(1, detail.detailed ? detail.round + 2 : 4, Math.max(2, detail.round / 2), 0, Math.PI * 2, 0, Math.PI / 2)
    .scale(.059, .066, .068).translate(...centre), BRONZE.cast);
  sculpt.add(loftGeometry([{ rx: .061, rz: .07, y: .836, z: .006 }, { rx: .061, rz: .07, y: .856, z: .006 }],
    detail.torso, { caps: false }), BRONZE.gilt, detail.detailed ? THOR_ATLAS.knot : undefined);
  sculpt.add(new BoxGeometry(.013, .05, .012).translate(0, .823, .074), BRONZE.cast);
  sculpt.add(taperedTube(curveThrough([[0, .85, .07], [0, .905, .01], [0, .86, -.06]]), .006, .006, 6, 4), BRONZE.gilt);
  for (const side of [-1, 1]) for (let feather = 0; feather < (detail.detailed ? 6 : 3); feather++) {
    const length = .05 + feather * .007, angle = .25 + feather * .24;
    // Feathers rise from the band on each side, fanning up and back like a gull's raised wing.
    sculpt.add(ellipsoid(5, [.008, length / 2, .0035], [0, length / 2, 0]).rotateZ(-side * (Math.PI / 2 - angle))
      .rotateY(side * .5).translate(side * .058, .862, -.004 - feather * .002), BRONZE.gilt);
  }
};

const beardRings: SculptRing[] = [{ rx: .016, rz: .012, y: .6, z: .104 }, { rx: .04, rz: .028, y: .635, z: .1 },
  { rx: .058, rz: .04, y: .68, z: .088 }, { rx: .066, rz: .048, y: .73, z: .068 }, { rx: .062, rz: .048, y: .765, z: .05 },
  { rx: .056, rz: .038, y: .79, z: .03 }, { rx: .052, rz: .036, y: .81, z: .022 }];

/** A plaited braid with a gilt bead at its end, hanging from `top` to `bottom`. */
const braid = (sculpt: Sculpt, top: SculptPoint, bottom: SculptPoint, radius: number) => {
  const middle: SculptPoint = [(top[0] + bottom[0]) / 2, (top[1] + bottom[1]) / 2, (top[2] + bottom[2]) / 2 + .006];
  sculpt.add(profileTube(curveThrough([top, middle, bottom]), t => radius * (1.1 - t * .35) *
    (1 + .22 * Math.abs(Math.sin(t * Math.PI * 6))), 12, 5), BRONZE.hair, THOR_ATLAS.strands);
  sculpt.add(ellipsoid(6, [radius * 1.1, radius * 1.5, radius * 1.1], bottom), BRONZE.gilt);
};

/** Strong-boned face: brow ridge, cheekbones, deep-set eyes, straight nose and a drooping moustache. */
const face = (sculpt: Sculpt, detail: ThorDetail) => {
  sculpt.add(ellipsoid(detail.round, [.05, .064, .059], [0, .832, .008]), BRONZE.skin);
  sculpt.add(ellipsoid(detail.round, [.045, .011, .018], [0, .845, .055]), BRONZE.skin);
  sculpt.add(loftGeometry([{ rx: .004, rz: .004, y: .808, z: .071 }, { rx: .012, rz: .012, y: .812, z: .064 },
    { rx: .009, rz: .009, y: .84, z: .06 }], 5), BRONZE.skin);
  // Mouth: a muzzle under the nose, the lower lip showing between moustache and beard.
  sculpt.add(ellipsoid(6, [.028, .018, .016], [0, .792, .056]), BRONZE.skin);
  sculpt.add(ellipsoid(6, [.016, .006, .008], [0, .786, .068]), BRONZE.skin);
  for (const side of [-1, 1]) {
    // Flat cheekbones under deep-set eyes (a dark socket and the eyeball) below the brow band.
    sculpt.add(ellipsoid(6, [.017, .008, .009], [side * .03, .815, .052]), BRONZE.skin);
    sculpt.add(ellipsoid(5, [.012, .008, .004], [side * .02, .829, .055]), BRONZE.eye);
    sculpt.add(ellipsoid(5, [.006, .005, .004], [side * .02, .828, .057]), BRONZE.cast);
    sculpt.add(taperedTube(curveThrough([[side * .004, .804, .07], [side * .028, .797, .066], [side * .04, .772, .056]]),
      .008, .004, 5, 5), BRONZE.hair, THOR_ATLAS.strands);
  }
};

/** Head: face, winged helmet, long hair falling in braids, and a full beard with two plaits. */
export const thorHead = (sculpt: Sculpt, detail: ThorDetail) => {
  sculpt.add(taperedTube(curveThrough([[0, .73, -.004], [0, .795, .004]]), .046, .04, 1, detail.limb), BRONZE.skin);
  face(sculpt, detail);
  helmet(sculpt, detail);
  sculpt.add(loftGeometry(detail.detailed ? beardRings : [beardRings[0]!, beardRings[2]!, beardRings[4]!, beardRings[6]!],
    detail.torso, { relief: (angle, y) => 1 + Math.cos(angle * 9) * .08 * Math.max(0, .77 - y) / .17 }),
  BRONZE.hair, detail.detailed ? THOR_ATLAS.strands : undefined);
  if (!detail.detailed) return;
  sculpt.add(ellipsoid(detail.round, [.058, .072, .042], [0, .8, -.03]), BRONZE.hair, THOR_ATLAS.strands);
  for (const side of [-1, 1]) {
    braid(sculpt, [side * .026, .66, .094], [side * .03, .55, .1], .011);
    braid(sculpt, [side * .04, .78, -.055], [side * .05, .62, -.135], .012);
  }
};
