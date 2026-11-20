import { BoxGeometry, type BufferGeometry, type CatmullRomCurve3,CylinderGeometry, TorusGeometry } from "three";

import { VIKING_ORNAMENT_BOXES } from "../../../render-common/buildings/viking-ornament-boxes";
import {
  type AtlasRect,   createColouredSculpt, curveThrough, ellipsoid, loftGeometry, profileTube, type SculptPoint, type SculptRing,
shellGeometry} from "../sculpt-geometry";
import { THOR_ATLAS } from "./viking-statue-textures";
import {
  BRONZE, HAMMER_GRIP, mjolnir, type Paint, type Sculpt, type ThorDetail,
thorHead} from "./viking-thor-regalia";

const pick = <T>(items: readonly T[], detail: ThorDetail, minimal: readonly number[]) =>
  detail.detailed ? items : minimal.map(index => items[index]!);

/** A limb through its joints whose radius follows a muscle profile. */
const limb = (sculpt: Sculpt, joints: readonly SculptPoint[], radiusAt: (t: number) => number, detail: ThorDetail,
  paint: Paint, rect?: AtlasRect) =>
  sculpt.add(profileTube(curveThrough(joints), radiusAt, detail.segments, detail.limb), paint, rect);

/** Smooth bump of height 1 at `centre` falling to 0 at ±`width` (muscle masses along a limb). */
const bump = (t: number, centre: number, width: number) => Math.max(0, 1 - ((t - centre) / width) ** 2);

const lerpPoint = (from: SculptPoint, to: SculptPoint, t: number) =>
  [0, 1, 2].map(axis => from[axis]! + (to[axis]! - from[axis]!) * t) as unknown as SculptPoint;

/** Leg-wrap bands crossing the shin (High). */
const legWraps = (sculpt: Sculpt, knee: SculptPoint, ankle: SculptPoint) => {
  for (let band = 0; band < 3; band++) {
    const centre = lerpPoint(knee, ankle, .2 + band * .27);
    sculpt.add(new TorusGeometry(.047 - band * .005, .0045, 3, 10).rotateX(Math.PI / 2 + (band % 2 ? .28 : -.28))
      .translate(...centre), BRONZE.leather);
  }
};

/** Striding legs: baggy trousers, wrapped shins and turned-down boots with an ankle strap. */
const legs = (sculpt: Sculpt, detail: ThorDetail) => {
  for (const side of [-1, 1]) {
    const stride = side * .055, hip: SculptPoint = [side * .06, .45, side * .004];
    const knee: SculptPoint = [side * .072, .255, stride * .7], ankle: SculptPoint = [side * .08, .07, stride * 1.2];
    limb(sculpt, [hip, [side * .068, .35, stride * .35], knee], t => .062 + .008 * bump(t, .3, .4) - .016 * t,
      detail, BRONZE.cloak);
    limb(sculpt, [knee, [side * .076, .17, stride], ankle], t => .046 + .006 * bump(t, .3, .3) - .012 * t,
      detail, BRONZE.cast);
    const foot: SculptPoint = [ankle[0], .028, ankle[2] + .03];
    if (!detail.detailed) continue;
    sculpt.add(ellipsoid(detail.round, [.038, .03, .072], foot), BRONZE.leather);
    sculpt.add(new CylinderGeometry(.043, .039, .07, detail.limb, 1, true).translate(ankle[0], .075, ankle[2]),
      BRONZE.leather);
    legWraps(sculpt, knee, [ankle[0], .1, ankle[2]]);
    sculpt.add(new TorusGeometry(.044, .007, 4, 12).rotateX(Math.PI / 2).translate(ankle[0], .11, ankle[2]),
      BRONZE.leather);
    sculpt.add(new TorusGeometry(.04, .004, 3, 12).rotateX(Math.PI / 2 - .5).translate(foot[0], .045, foot[2] - .01),
      BRONZE.dark);
  }
};

const BYRNIE: SculptRing[] = [{ rx: .135, rz: .105, y: .31 }, { rx: .128, rz: .095, y: .36 },
  { rx: .118, rz: .083, y: .43 }, { rx: .11, rz: .077, y: .5 }, { rx: .122, rz: .083, y: .56, z: .006 },
  { rx: .142, rz: .095, y: .62, z: .012 }, { rx: .156, rz: .094, y: .67, z: .01 }, { rx: .158, rz: .084, y: .71 },
  { rx: .12, rz: .07, y: .735 }, { rx: .07, rz: .055, y: .752 }];

/** Pectoral and shoulder-blade masses pushing the mail forward and back. */
const chestRelief = (angle: number, y: number) =>
  1 + .07 * Math.cos(angle) ** 2 * bump(y, .645, .06) * (Math.cos(angle) > 0 ? 1 : .5);

/** Gilt mounts riveted round the belt (High). */
const beltMounts = (sculpt: Sculpt) => {
  sculpt.add(new BoxGeometry(.012, .062, .02).translate(.031, .522, .088), BRONZE.gilt);
  for (const angle of [-1.1, -.55, .55, 1.1])
    sculpt.add(new BoxGeometry(.022, .03, .008).rotateY(angle).translate(Math.sin(angle) * .121, .522,
      Math.cos(angle) * .087), BRONZE.gilt);
};

/** Knee-length mail byrnie over a tunic hem, a broad belt with gilt mounts, buckle and pouch. */
const torso = (sculpt: Sculpt, detail: ThorDetail) => {
  sculpt.add(loftGeometry(pick(BYRNIE, detail, [0, 3, 6, 8, 9]), detail.torso, { relief: chestRelief }), BRONZE.mail,
    detail.detailed ? THOR_ATLAS.mail : undefined);
  if (!detail.detailed) return;
  sculpt.add(loftGeometry([{ rx: .142, rz: .11, y: .27 }, { rx: .134, rz: .1, y: .32 }], detail.torso), BRONZE.cloak);
  sculpt.add(loftGeometry([{ rx: .118, rz: .084, y: .5 }, { rx: .12, rz: .086, y: .545 }], detail.torso,
    { caps: false }), BRONZE.leather, THOR_ATLAS.knot);
  sculpt.add(new BoxGeometry(.05, .052, .014).translate(0, .522, .088), BRONZE.gilt, THOR_ATLAS.knot);
  beltMounts(sculpt);
  sculpt.add(ellipsoid(8, [.03, .04, .022], [.112, .468, .045]), BRONZE.leather);
  for (const side of [-1, 1])
    sculpt.add(ellipsoid(8, [.05, .022, .04], [side * .07, .735, -.012]), BRONZE.mail, THOR_ATLAS.mail);
};

const CLOAK: SculptRing[] = [{ rx: .235, rz: .165, y: .1, z: -.075 }, { rx: .222, rz: .15, y: .22, z: -.06 },
  { rx: .205, rz: .134, y: .34, z: -.045 }, { rx: .19, rz: .12, y: .46, z: -.032 }, { rx: .178, rz: .11, y: .57, z: -.02 },
  { rx: .17, rz: .1, y: .66, z: -.008 }, { rx: .165, rz: .092, y: .715 }, { rx: .135, rz: .078, y: .745 }];

/** Deep, irregular drapery folds that soften towards the shoulders. */
const cloakFolds = (angle: number, y: number) => {
  const depth = Math.min(1, Math.max(0, (.72 - y) / .45));
  return 1 + depth * (.075 * Math.cos(angle * 11 + y * 4) + .035 * Math.cos(angle * 5 - y * 7));
};

/** A long cloak swept back in the wind, pinned with knotwork brooches at both shoulders. */
const cloak = (sculpt: Sculpt, detail: ThorDetail) => {
  const [outer, inner, edge] = shellGeometry(pick(CLOAK, detail, [0, 4, 7]), detail.detailed ? 20 : 4, .012,
    { arc: [Math.PI * .5, Math.PI * 1.5], relief: cloakFolds });
  sculpt.add(outer!, BRONZE.cloak); sculpt.add(inner!, BRONZE.dark); sculpt.add(edge!, BRONZE.cloak);
  if (!detail.detailed) return;
  for (const side of [-1, 1]) {
    sculpt.add(new CylinderGeometry(.024, .024, .008, 12).rotateX(Math.PI / 2).translate(side * .118, .712, .078),
      BRONZE.gilt, THOR_ATLAS.knot);
    sculpt.add(new TorusGeometry(.024, .004, 4, 14).translate(side * .118, .712, .082), BRONZE.gilt);
  }
};

/** Clenched fist at rest: palm mass, a row of knuckles and the thumb across the fingers. */
const clenchedFist = (sculpt: Sculpt, centre: SculptPoint, detail: ThorDetail, facing: number) => {
  sculpt.add(ellipsoid(detail.detailed ? 7 : 4, [.03, .034, .03], centre), BRONZE.skin);
  if (!detail.detailed) return;
  for (let finger = 0; finger < 4; finger++) sculpt.add(ellipsoid(5, [.01, .01, .012],
    [centre[0] + facing * .026, centre[1] + .02 - finger * .013, centre[2] + .012]), BRONZE.skin);
  sculpt.add(ellipsoid(5, [.009, .02, .009], [centre[0] + facing * .018, centre[1] + .005, centre[2] + .024]),
    BRONZE.skin);
};

/** Curled fingers of the gripping fist: index (top) to little finger, ring radius and height. */
const GRIP_FINGERS = [[.0275, .021], [.0275, .007], [.0265, -.007], [.025, -.02]] as const;

/**
 * Fist closed round the upright haft: four curled fingers wrap it (stacked rolls, index on top),
 * the back of the hand and palm sit on the wrist side and the thumb locks over the index finger.
 */
const grippingFist = (sculpt: Sculpt, grip: SculptPoint, wrist: SculptPoint, detail: ThorDetail) => {
  const toWrist = [wrist[0] - grip[0], 0, wrist[2] - grip[2]], reach = Math.hypot(toWrist[0]!, toWrist[2]!) || 1;
  const palm: SculptPoint = [grip[0] + toWrist[0]! / reach * .02, grip[1] - .004, grip[2] + toWrist[2]! / reach * .02];
  sculpt.add(ellipsoid(detail.detailed ? 7 : 4, [.029, .036, .029], palm), BRONZE.skin);
  if (!detail.detailed) return;
  for (const [radius, rise] of GRIP_FINGERS) sculpt.add(new TorusGeometry(radius, .0085, 5, 12).rotateX(Math.PI / 2)
    .translate(grip[0], grip[1] + rise, grip[2]), BRONZE.skin);
  const thumb: SculptPoint = [grip[0] - toWrist[2]! / reach * .02, grip[1] + .03, grip[2] + toWrist[0]! / reach * .02];
  sculpt.add(ellipsoid(5, [.011, .009, .011], thumb), BRONZE.skin);
};

interface Arm { elbow: SculptPoint; shoulder: SculptPoint; wrist: SculptPoint }

/** One smooth arm through shoulder, elbow and wrist; `elbowT` is the elbow's share of its length. */
const armCurve = ({ elbow, shoulder, wrist }: Arm) => {
  const upper = Math.hypot(...elbow.map((value, axis) => value - shoulder[axis]!) as [number, number, number]);
  const lower = Math.hypot(...wrist.map((value, axis) => value - elbow[axis]!) as [number, number, number]);
  return { curve: curveThrough([shoulder, elbow, wrist]), elbowT: upper / (upper + lower) };
};

/**
 * Muscle profile along the arm: deltoid into a swelling biceps that narrows to a rounded elbow, then
 * the forearm's mass below the elbow tapering to the wrist (no pinched joint between them).
 */
const armRadius = (elbowT: number) => (t: number) => {
  if (t <= elbowT) {
    const u = t / elbowT;
    return .051 + .01 * bump(u, .5, .38) - .011 * u;
  }
  const v = (t - elbowT) / (1 - elbowT);
  return .04 + .008 * bump(v, .28, .3) - .016 * v;
};

const pointOn = (curve: CatmullRomCurve3, t: number): SculptPoint => curve.getPointAt(t).toArray();

/** High: mail half-sleeve, a gilt ring on the biceps and a knotwork leather bracer. */
const armGear = (sculpt: Sculpt, detail: ThorDetail, { curve, elbowT }: ReturnType<typeof armCurve>) => {
  const radius = armRadius(elbowT);
  const sleeve = (from: number, to: number, outset: number, segments: number, paint: Paint, rect?: AtlasRect) =>
    sculpt.add(profileTube(curveThrough([pointOn(curve, from), pointOn(curve, (from + to) / 2), pointOn(curve, to)]),
      t => radius(from + (to - from) * t) + outset, segments, detail.limb), paint, rect);
  sleeve(0, elbowT * .42, .006, 3, BRONZE.mail, THOR_ATLAS.mail);
  sleeve(elbowT * .64, elbowT * .72, .006, 1, BRONZE.gilt);
  sleeve(elbowT + (1 - elbowT) * .45, .97, .004, 2, BRONZE.leather, THOR_ATLAS.knot);
};

/** Heroic arm: one tube from the mailed deltoid through a rounded elbow to the wrist. */
const arm = (sculpt: Sculpt, detail: ThorDetail, joints: Arm) => {
  const path = armCurve(joints);
  sculpt.add(profileTube(path.curve, armRadius(path.elbowT), detail.segments * 2 + 2, detail.limb), BRONZE.skin);
  if (!detail.detailed) return;
  sculpt.add(ellipsoid(detail.round, [.058, .052, .058], joints.shoulder), BRONZE.mail, THOR_ATLAS.mail);
  armGear(sculpt, detail, path);
};

/** Raised right arm brandishing Mjölnir overhead; the left fist clenched at the hip, ready. */
const arms = (sculpt: Sculpt, detail: ThorDetail) => {
  const raised: Arm = { elbow: [-.245, .83, .022], shoulder: [-.152, .7, 0], wrist: [-.172, .968, .05] };
  arm(sculpt, detail, raised);
  grippingFist(sculpt, HAMMER_GRIP, raised.wrist, detail);
  arm(sculpt, detail, { elbow: [.205, .53, -.012], shoulder: [.152, .7, 0], wrist: [.172, .415, .055] });
  clenchedFist(sculpt, [.168, .385, .07], detail, -1);
};

/**
 * Original bronze Thor for the Viking headquarters: a striding, broad-shouldered warrior in mail with a
 * swept cloak, winged helmet, braided beard and hair, raising a heavy knotwork Mjölnir. One mesh in
 * its own statue batch; Minimal keeps the silhouette (stance, cloak, beard, helmet and hammer).
 */
export const createVikingThorStatue = (detailed: boolean): BufferGeometry => {
  const sculpt = createColouredSculpt();
  const detail: ThorDetail = detailed ? { detailed, limb: 8, round: 8, segments: 6, torso: 18 }
    : { detailed, limb: 5, round: 6, segments: 3, torso: 8 };
  legs(sculpt, detail);
  torso(sculpt, detail);
  cloak(sculpt, detail);
  arms(sculpt, detail);
  thorHead(sculpt, detail);
  mjolnir(sculpt, detail);
  const { max, min } = VIKING_ORNAMENT_BOXES["thor-statue"];
  return sculpt.build({ max, min }, THOR_ATLAS.plain);
};
