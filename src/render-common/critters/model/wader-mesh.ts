import { lerp3, quadraticBezier3 } from "../../../shared/world/noise";
import type { PropMesh, Vec3 } from "../../props/mesh-builder";
import {
  add,
  countershade,
  CritterBuilder,
  flat,
  type LoftStation,
  pitchAbout,
  rollAbout,
  scale,
  unit} from "./critter-builder";
import type { WaderPose, WaderShape } from "./wader-shape";

const TAU = Math.PI * 2;
/** Body stations: x share of the length, radius share, lift share of the height. */
const BODY: readonly (readonly [number, number, number])[] = [
  [-0.5, 0.3, 0.25],
  [-0.32, 0.72, 0.12],
  [-0.1, 0.98, 0],
  [0.12, 1, 0],
  [0.32, 0.82, 0.08],
  [0.47, 0.5, 0.3]
];
const SPAN_STATIONS = [0, 0.4, 0.75, 1];
const CHORD_STATIONS = [0, 0.5, 1];
const LEG_SWING = 0.42;
const TRAIL_LEGS = -1.45;

/** The body's tilt for a pose (standing tilt, level in flight). */
const getTilt = (shape: WaderShape, pose: WaderPose) => shape.bodyTilt * (1 - pose.level);

const getHip = (shape: WaderShape): Vec3 => [0, shape.legLength, 0];

/** A body local point (x along the body, y up, z left) placed with the tilt about the hip. */
const toBody = (shape: WaderShape, pose: WaderPose, local: Vec3): Vec3 => {
  const hip = getHip(shape);
  const centre = add(hip, [0.015, shape.bodyHeight * 0.55, 0]);
  return pitchAbout(add(centre, local), hip, getTilt(shape, pose));
};

const addBody = (builder: CritterBuilder, shape: WaderShape, pose: WaderPose) => {
  const { back, belly } = shape.colors;
  const stations: LoftStation[] = BODY.map(([x, radius, lift]) => ({
    at: toBody(shape, pose, [x * shape.bodyLength, lift * shape.bodyHeight, 0]),
    height: shape.bodyHeight * radius,
    width: shape.bodyWidth * radius
  }));
  builder.loft(stations, {
    endTip: shape.bodyHeight * 0.2,
    paint: countershade(back, belly, -0.1, 0.6),
    sides: 10,
    startTip: shape.bodyHeight * 0.3
  });
  const tailStart = toBody(shape, pose, [-0.45 * shape.bodyLength, 0.2 * shape.bodyHeight, 0]);
  const tailEnd = toBody(shape, pose, [
    -0.45 * shape.bodyLength - shape.tailLength,
    0.15 * shape.bodyHeight,
    0
  ]);
  builder.loft(
    [
      { at: tailEnd, height: shape.bodyHeight * 0.1, width: shape.bodyWidth * 0.35 },
      { at: tailStart, height: shape.bodyHeight * 0.22, width: shape.bodyWidth * 0.55 }
    ],
    { paint: flat(shape.colors.tail), sides: 6, startTip: 0.004 }
  );
};

/** Where the neck leaves the body, its S bend control point and the head centre. */
const getNeckPath = (shape: WaderShape, pose: WaderPose) => {
  const base = toBody(shape, pose, [0.44 * shape.bodyLength, 0.42 * shape.bodyHeight, 0]);
  const length = shape.neckLength;
  const relaxedHead = add(base, [0.16 * length, 0.55 * length, 0]);
  const relaxedBend = add(base, [-0.3 * shape.neckFold * length, 0.3 * length, 0]);
  const upHead = add(base, [0.2 * length, 0.97 * length, 0]);
  const upBend = add(base, [0.02 * length, 0.5 * length, 0]);
  const reachHead: Vec3 = [
    base[0] + 0.6 * length + shape.billLength * 0.4,
    shape.billLength * 0.55,
    0
  ];
  const reachBend = add(base, [0.4 * length, 0.15 * length, 0]);
  const levelHead = add(base, [0.3 * length, 0.12 * length, 0]);
  const levelBend = add(base, [-0.05 * length, 0.18 * length, 0]);
  const standHead = lerp3(relaxedHead, upHead, pose.neckUp);
  const standBend = lerp3(relaxedBend, upBend, pose.neckUp);
  const head = lerp3(lerp3(standHead, levelHead, pose.level), reachHead, pose.reach);
  const bend = lerp3(lerp3(standBend, levelBend, pose.level), reachBend, pose.reach);
  return { base, bend, head };
};

const addNeck = (builder: CritterBuilder, shape: WaderShape, pose: WaderPose) => {
  const { base, bend, head } = getNeckPath(shape, pose);
  const { neck } = shape.colors;
  const stations: LoftStation[] = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => {
    const radius = shape.neckRadius * (1.25 - t * 0.5);
    return { at: quadraticBezier3(base, bend, head, t), height: radius, width: radius };
  });
  builder.loft(stations, { paint: flat(neck), sides: 7 });
};

/** Bill direction: forward and slightly down; straight down while reaching for prey. */
const getBillDirection = (pose: WaderPose): Vec3 => {
  const angle = -0.18 - pose.reach * 1.05 + pose.neckUp * 0.12 + pose.level * 0.1;
  return [Math.cos(angle), Math.sin(angle), 0];
};

const addHead = (builder: CritterBuilder, shape: WaderShape, pose: WaderPose) => {
  const { head } = getNeckPath(shape, pose);
  const direction = getBillDirection(pose);
  const radius = shape.headRadius;
  const { bill, cap, eye, face } = shape.colors;
  builder.ellipsoid(head, direction, [radius * 1.2, radius * 0.92, radius * 0.85], (along, up) =>
    up > 0.55 && along > 0.25 ? cap : face
  );
  const billBase = add(head, scale(direction, radius * 1.05));
  const billTip = add(billBase, scale(direction, shape.billLength));
  builder.loft(
    [
      { at: billBase, height: shape.billRadius * 1.1, width: shape.billRadius },
      {
        at: lerp3(billBase, billTip, 0.6),
        height: shape.billRadius * 0.6,
        width: shape.billRadius * 0.55
      },
      { at: billTip, height: shape.billRadius * 0.12, width: shape.billRadius * 0.12 }
    ],
    { endTip: shape.billRadius * 0.4, paint: flat(bill), sides: 5 }
  );
  for (const side of [-1, 1]) {
    const at = add(add(head, scale(direction, radius * 0.45)), [
      0,
      radius * 0.25,
      side * radius * 0.78
    ]);
    builder.ellipsoid(
      at,
      direction,
      [radius * 0.22, radius * 0.22, radius * 0.18],
      flat(eye),
      3,
      5
    );
  }
};

/** One leg: hip, ankle (bends backwards), foot with three toes forward and one back. */
const addLeg = (builder: CritterBuilder, shape: WaderShape, pose: WaderPose, side: number) => {
  const lag = side > 0 ? 0 : 0.5;
  const phase = pose.stride === 0 ? 0 : (pose.step + lag) * TAU;
  const swing = LEG_SWING * pose.stride * Math.sin(phase);
  const lift = pose.stride * Math.max(0, Math.cos(phase));
  const hip: Vec3 = [0, shape.legLength, side * shape.bodyWidth * 0.45];
  const length = shape.legLength;
  const turn = (point: Vec3) =>
    pitchAbout(pitchAbout(point, hip, swing), hip, TRAIL_LEGS * pose.legsBack);
  const ankle = turn([-0.03 * length - lift * 0.08 * length, length * 0.5, hip[2]]);
  const foot = turn([0.02 * length, lift * 0.28 * length, hip[2]]);
  const radius = shape.legRadius;
  builder.loft(
    [
      { at: turn(add(hip, [0, 0.03, 0])), height: radius * 1.6, width: radius * 1.6 },
      { at: ankle, height: radius * 1.1, width: radius * 1.1 },
      { at: foot, height: radius * 0.8, width: radius * 0.8 }
    ],
    { paint: flat(shape.colors.legs), sides: 5 }
  );
  addToes(builder, shape, foot, pose.legsBack);
};

const TOE_ANGLES = [-0.55, 0, 0.55, Math.PI];

const addToes = (builder: CritterBuilder, shape: WaderShape, foot: Vec3, trailing: number) => {
  const length = shape.legLength * 0.22 * (1 - trailing * 0.5);
  for (const angle of TOE_ANGLES) {
    const reach = angle === Math.PI ? length * 0.45 : length;
    const direction: Vec3 = lerp3(
      [Math.cos(angle), 0, Math.sin(angle)],
      [-0.9, 0, Math.sin(angle) * 0.2],
      trailing
    );
    const tip = add(foot, scale(unit(direction), reach));
    builder.loft(
      [
        { at: foot, height: shape.legRadius * 0.6, up: [0, 1, 0], width: shape.legRadius * 0.6 },
        { at: tip, height: shape.legRadius * 0.3, up: [0, 1, 0], width: shape.legRadius * 0.3 }
      ],
      { endTip: 0.002, paint: flat(shape.colors.legs), sides: 3 }
    );
  }
};

/** A wing point: folded on the flank (body space) mixed with spread out to the side. */
const getWingPoint = (
  shape: WaderShape,
  pose: WaderPose,
  side: number,
  span: number,
  chord: number
) => {
  const length = shape.bodyLength;
  const fold = 0.85 * length;
  const folded = toBody(shape, pose, [
    0.28 * length - span * fold - chord * shape.wingChord * 0.3,
    shape.bodyHeight * (0.55 - chord * 0.75) - span * shape.bodyHeight * 0.25,
    side * (shape.bodyWidth * (1.04 - span * 0.35) + 0.002)
  ]);
  const shoulder = toBody(shape, pose, [
    0.22 * length,
    shape.bodyHeight * 0.45,
    side * shape.bodyWidth * 0.7
  ]);
  const sweep = span * span * shape.wingChord * 0.6;
  const width = shape.wingChord * (1.25 - span * 0.55);
  const spread = rollAbout(
    add(shoulder, [-sweep - chord * width, span * span * 0.01, side * span * shape.wingSpan]),
    shoulder,
    -side * pose.flap
  );
  return lerp3(folded, spread, pose.spread);
};

const getWingColor = (shape: WaderShape, span: number) => {
  const { wing, wingTip } = shape.colors;
  return span > 0.7 ? wingTip : wing;
};

const addWing = (builder: CritterBuilder, shape: WaderShape, pose: WaderPose, side: number) => {
  const rows = SPAN_STATIONS.map((span) =>
    CHORD_STATIONS.map((chord) => getWingPoint(shape, pose, side, span, chord))
  );
  const outward: Vec3 = lerp3([0, 0, side], [0, 1, 0], pose.spread);
  builder.sheet(
    rows,
    (row) => getWingColor(shape, SPAN_STATIONS[row]!),
    outward
  );
};

/** One pose of a wader as a mesh (the vertices are the same for every pose of a shape). */
export const createWaderMesh = (shape: WaderShape, pose: WaderPose): PropMesh => {
  const builder = new CritterBuilder();
  addBody(builder, shape, pose);
  addNeck(builder, shape, pose);
  addHead(builder, shape, pose);
  for (const side of [1, -1]) {
    addLeg(builder, shape, pose, side);
    addWing(builder, shape, pose, side);
  }
  return builder.finish();
};
