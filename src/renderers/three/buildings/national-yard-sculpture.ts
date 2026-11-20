import { CylinderGeometry, TorusGeometry } from "three";

import {
  createColouredSculpt, curveThrough, ellipsoid, loftGeometry, type SculptColor,
  type SculptPoint,
taperedTube} from "../sculpt-geometry";

type Sculpt = ReturnType<typeof createColouredSculpt>;
const WOOD: SculptColor = [1, .93, .81];
const RUST: SculptColor = [.94, .48, .28];
const GROOVE: SculptColor = [.16, .12, .085];
const CLAY: SculptColor = [.96, .77, .55];
const JADE: SculptColor = [.43, .66, .54];
const limb = (sculpt: Sculpt, points: readonly SculptPoint[], radius: number, detailed: boolean,
  colour: SculptColor, end = radius * .8) =>
  sculpt.add(taperedTube(curveThrough(points), radius, end, detailed ? 12 : 3, detailed ? 10 : 5), colour);

/** Original carved guardian post, with a single sculpted face and geometric painted wood bands. */
const guardian = (detailed: boolean) => {
  const sculpt = createColouredSculpt(), sides = detailed ? 20 : 8;
  sculpt.add(loftGeometry([
    { y: 0, rx: .12, rz: .10 }, { y: .05, rx: .13, rz: .105 },
    { y: .11, rx: .105, rz: .085 }, { y: .44, rx: .11, rz: .09 },
    { y: .54, rx: .12, rz: .085 }, { y: .62, rx: .105, rz: .086 },
    { y: .68, rx: .12, rz: .10 }, { y: .82, rx: .12, rz: .105 },
    { y: .91, rx: .11, rz: .09 }, { y: .94, rx: .09, rz: .075 },
  ], sides, { relief: (angle, y) => 1 - .025 * Math.cos(angle * 8) ** 6 * Math.sin(y * 16) ** 8 }),
  point => point.y > .46 && point.y < .515 || point.y > .12 && point.y < .165 ? RUST : WOOD);
  for (const side of [-1, 1]) {
    // Ear/crest tips grow from the same carved crown, never a detached animal model.
    limb(sculpt, [[side * .083, .85, 0], [side * .105, .94, .005], [side * .106, .985, .005]],
      .035, detailed, WOOD, .012);
    sculpt.add(ellipsoid(detailed ? 14 : 6, [.031, .018, .012], [side * .048, .78, .099]), GROOVE);
    limb(sculpt, [[side * .077, .804, .10], [side * .047, .815, .11], [side * .018, .803, .113]],
      .011, detailed, WOOD);
    limb(sculpt, [[side * .09, .49, .058], [side * .084, .39, .09], [side * .025, .355, .105]],
      .022, detailed, WOOD);
  }
  sculpt.add(loftGeometry([{ y: .692, rx: .009, rz: .009, z: .112 },
    { y: .731, rx: .026, rz: .025, z: .115 }, { y: .792, rx: .016, rz: .014, z: .10 }],
  detailed ? 12 : 5), WOOD);
  sculpt.add(ellipsoid(detailed ? 12 : 6, [.044, .006, .007], [0, .66, .094]), GROOVE);
  if (detailed) for (const side of [-1, 1]) for (let line = 0; line < 3; line++)
    limb(sculpt, [[side * .025, .61 - line * .018, .092],
      [side * .052, .594 - line * .018, .087], [side * .08, .61 - line * .018, .072]],
    .003, true, GROOVE);
  return sculpt.build({ min: [-.14, 0, -.12], max: [.14, 1, .15] });
};

const figurineHead = (sculpt: Sculpt, detailed: boolean) => {
  sculpt.add(loftGeometry([{ y: .54, rx: .055, rz: .045, z: .012 },
    { y: .57, rx: .079, rz: .065, z: .012 }, { y: .64, rx: .101, rz: .073, z: .005 },
    { y: .75, rx: .104, rz: .08 }, { y: .80, rx: .087, rz: .07 },
    { y: .825, rx: .06, rz: .05 }], detailed ? 24 : 10), CLAY);
  for (const side of [-1, 1]) {
    sculpt.add(ellipsoid(detailed ? 14 : 6, [.027, .034, .021], [side * .105, .663, .005]), CLAY);
    sculpt.add(new TorusGeometry(.023, .009, detailed ? 6 : 3, detailed ? 16 : 6)
      .translate(side * .108, .637, .027), JADE);
    sculpt.add(ellipsoid(detailed ? 12 : 6, [.026, .007, .005], [side * .041, .699, .073]), GROOVE);
    limb(sculpt, [[side * .067, .715, .068], [side * .041, .724, .079], [side * .015, .714, .083]],
      .006, detailed, CLAY);
  }
  sculpt.add(loftGeometry([{ y: .638, rx: .012, rz: .012, z: .084 },
    { y: .663, rx: .022, rz: .025, z: .084 }, { y: .716, rx: .012, rz: .012, z: .073 }],
  detailed ? 12 : 5), CLAY);
  sculpt.add(ellipsoid(detailed ? 12 : 6, [.031, .004, .004], [0, .603, .073]), GROOVE);
  sculpt.add(new TorusGeometry(.091, .012, detailed ? 7 : 3, detailed ? 24 : 8)
    .rotateX(Math.PI / 2).scale(1, 1, .86).translate(0, .776, .004), JADE);
  // A stepped, newly authored diadem; no borrowed inscription or ceremonial face design.
  sculpt.add(loftGeometry([{ y: .785, rx: .072, rz: .043 }, { y: .817, rx: .072, rz: .043 },
    { y: .818, rx: .048, rz: .033 }, { y: .856, rx: .048, rz: .033 },
    { y: .857, rx: .025, rz: .025 }, { y: .891, rx: .025, rz: .025 }],
  detailed ? 12 : 6), JADE);
};

/** Original seated clay figure: modeled hands, earspools and actual incised neck/waist grooves. */
const figurine = (detailed: boolean) => {
  const sculpt = createColouredSculpt();
  sculpt.add(new CylinderGeometry(.23, .24, .045, detailed ? 24 : 8).translate(0, .0225, 0), CLAY);
  sculpt.add(loftGeometry([{ y: .12, rx: .13, rz: .09 }, { y: .21, rx: .135, rz: .10 },
    { y: .25, rx: .10, rz: .075 }, { y: .27, rx: .095, rz: .074 },
    { y: .28, rx: .106, rz: .082 }, { y: .295, rx: .095, rz: .073 },
    { y: .31, rx: .102, rz: .08 }, { y: .40, rx: .146, rz: .097 },
    { y: .455, rx: .12, rz: .08 }, { y: .48, rx: .059, rz: .055 },
    { y: .495, rx: .045, rz: .045 }, { y: .515, rx: .052, rz: .05 },
    { y: .53, rx: .045, rz: .045 }, { y: .555, rx: .047, rz: .045 }],
  detailed ? 24 : 10), point => point.y > .255 && point.y < .31 ? RUST : CLAY);
  for (const side of [-1, 1]) {
    limb(sculpt, [[side * .105, .20, -.015], [side * .18, .115, .035], [side * .025, .075, .14]],
      .065, detailed, CLAY, .035);
    limb(sculpt, [[side * .122, .42, 0], [side * .164, .31, .055], [side * .086, .239, .105]],
      .038, detailed, CLAY, .025);
    sculpt.add(ellipsoid(detailed ? 14 : 6, [.038, .018, .026], [side * .078, .225, .113]), CLAY);
    if (detailed) for (let finger = 0; finger < 3; finger++)
      limb(sculpt, [[side * (.055 + finger * .014), .233, .134],
        [side * (.055 + finger * .014), .215, .133]], .0025, true, GROOVE);
  }
  figurineHead(sculpt, detailed);
  return sculpt.build({ min: [-.25, 0, -.25], max: [.25, .92, .25] });
};

export const createNationalYardSculptureGeometry = (variant: number, detailed: boolean) =>
  variant === 1 ? figurine(detailed) : guardian(detailed);
