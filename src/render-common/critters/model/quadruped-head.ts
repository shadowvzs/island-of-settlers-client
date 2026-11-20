import { lerp3 } from "../../../shared/world/noise";
import { cross, type Vec3 } from "../../props/mesh-builder";
import { add, CritterBuilder, scale, sub, unit, yawAbout } from "./critter-builder";
import { getBodyY, paintPart } from "./quadruped-common";
import type { QuadPose, QuadShape } from "./quadruped-shape";

/** Ring and ellipsoid resolution of the head parts (see quadruped-mesh). */
const NECK_SIDES = 12;
const HEAD_RINGS = 7;
const HEAD_SIDES = 12;
const SNOUT_SIDES = 10;
const EAR_SIDES = 6;

/** Neck and head directions: level forward, lowered to reach the ground, turned by the yaw. */
const getHeadFrame = (shape: QuadShape, pose: QuadPose) => {
  const centreY = getBodyY(shape, pose);
  const base: Vec3 = [0.42 * shape.bodyLength, centreY + 0.4 * shape.bodyHeight, 0];
  const lowered = pose.reach * (shape.neckAngle + 1.05) + pose.rest * 0.35;
  const neckAngle = shape.neckAngle - lowered;
  const neckDirection = yawAbout(
    [Math.cos(neckAngle), Math.sin(neckAngle), 0],
    [0, 0, 0],
    pose.headYaw
  );
  const neckEnd = add(base, scale(neckDirection, shape.neckLength));
  const headPitch = -pose.reach * 0.95 - pose.rest * 0.15;
  const headDirection = yawAbout(
    [Math.cos(headPitch), Math.sin(headPitch), 0],
    [0, 0, 0],
    pose.headYaw
  );
  const head = add(neckEnd, scale(headDirection, shape.headLength * 0.35));
  const side = yawAbout([0, 0, 1], [0, 0, 0], pose.headYaw);
  const up = unit(cross(side, headDirection));
  return { base, head, headDirection, neckEnd, side, up };
};

export const addNeckAndHead = (builder: CritterBuilder, shape: QuadShape, pose: QuadPose) => {
  const frame = getHeadFrame(shape, pose);
  const { base, head, headDirection, neckEnd } = frame;
  builder.loft(
    [
      { at: base, height: shape.neckRadius * 1.15, width: shape.neckRadius * 1.05 },
      { at: lerp3(base, neckEnd, 0.55), height: shape.neckRadius, width: shape.neckRadius * 0.92 },
      { at: neckEnd, height: shape.neckRadius * 0.86, width: shape.neckRadius * 0.82 },
      {
        // Along the neck (not the head): a station folded back would flip the ring winding.
        at: add(neckEnd, scale(unit(sub(neckEnd, base)), shape.headLength * 0.2)),
        height: Math.min(shape.neckRadius * 0.7, shape.headRadius * 0.8),
        width: Math.min(shape.neckRadius * 0.66, shape.headRadius * 0.75)
      }
    ],
    { paint: paintPart(shape, "neck", () => neckEnd), sides: NECK_SIDES }
  );
  const radii: Vec3 = [shape.headLength * 0.55, shape.headRadius, shape.headRadius * 0.92];
  builder.ellipsoid(
    head,
    headDirection,
    radii,
    paintPart(shape, "head", () => head),
    HEAD_RINGS,
    HEAD_SIDES,
    frame.up
  );
  addSnout(builder, shape, frame);
  addEyes(builder, shape, frame);
  for (const sign of [1, -1]) addEar(builder, shape, frame, sign);
};

type HeadFrame = ReturnType<typeof getHeadFrame>;

/** Muzzle depth (height over width): flatter than wide. */
const MUZZLE_DEPTH = 0.82;

/** Ring heights (1 bridge .. -1 chin) of the painted mouth line and of the chin below it. */
const LIP_TOP = -0.22;
const LIP_BOTTOM = -0.5;

/**
 * The muzzle as one continuous surface: from the stop in front of the eyes it tapers to the
 * nose pad, the bridge line straight and the cross section flatter than wide (canids, bovids),
 * deeper at the base where the jaw sits. The
 * mouth line is painted along its sides (like the nose), the chin below it (no separate jaw
 * piece, so no seams or slivers).
 */
const addUpperMuzzle = (builder: CritterBuilder, shape: QuadShape, frame: HeadFrame) => {
  const { head, headDirection, up } = frame;
  const radius = shape.snoutRadius;
  const start = add(head, scale(headDirection, shape.headLength * 0.1));
  const at = (t: number, lift: number) =>
    add(add(start, scale(headDirection, shape.snoutLength * 1.1 * t)), scale(up, lift * radius));
  const stations = [
    [0, 1.9, 1.7, 0.1],
    [0.3, 1.38, 1.24, 0],
    [0.7, 0.98, 0.95, -0.03],
    [1, 0.74, 0.78, -0.02]
  ] as const;
  const tip = at(1, 0);
  const muzzle = paintPart(shape, "snout", () => tip);
  const lip = paintPart(shape, "nose", () => tip);
  builder.loft(
    stations.map(([t, height, width, lift]) => ({
      at: at(t, lift),
      height: height * radius * MUZZLE_DEPTH,
      up,
      width: width * radius
    })),
    {
      paint: (along, ringUp, side) => {
        if (ringUp < LIP_BOTTOM) return muzzle(along, -0.9, side);
        const onLip = ringUp < LIP_TOP && along > 0.25;
        return onLip ? lip(along, ringUp, side) : muzzle(along, ringUp, side);
      },
      sides: SNOUT_SIDES
    }
  );
  return tip;
};

/** The nose pad (rhinarium) at the muzzle tip: wide and flat. */
const addNosePad = (builder: CritterBuilder, shape: QuadShape, frame: HeadFrame, tip: Vec3) => {
  const { headDirection, up } = frame;
  const radius = shape.snoutRadius;
  const nose = add(add(tip, scale(headDirection, radius * 0.1)), scale(up, radius * 0.08));
  const size: Vec3 = [radius * 0.26, radius * 0.44 * MUZZLE_DEPTH, radius * 0.6];
  builder.ellipsoid(nose, headDirection, size, paintPart(shape, "nose", () => nose), 3, 8, up);
};

/**
 * Cheek (zygomatic) volume behind the muzzle: mostly inside the skull, so it only rounds the
 * face between eye and muzzle.
 */
const addCheeks = (builder: CritterBuilder, shape: QuadShape, frame: HeadFrame) => {
  const { head, headDirection, side, up } = frame;
  const paint = paintPart(shape, "head", () => head);
  const size: Vec3 = [shape.headLength * 0.36, shape.headRadius * 0.55, shape.headRadius * 0.5];
  for (const sign of [1, -1]) {
    const forward = add(head, scale(headDirection, shape.headLength * 0.14));
    const lowered = add(forward, scale(up, -shape.headRadius * 0.22));
    const cheek = add(lowered, scale(side, sign * shape.headRadius * 0.38));
    builder.ellipsoid(cheek, headDirection, size, paint, 5, 10, up);
  }
};

/** The muzzle with its mouth line, the nose pad and the cheeks. */
const addSnout = (builder: CritterBuilder, shape: QuadShape, frame: HeadFrame) => {
  const tip = addUpperMuzzle(builder, shape, frame);
  addNosePad(builder, shape, frame, tip);
  addCheeks(builder, shape, frame);
};

const addEyes = (builder: CritterBuilder, shape: QuadShape, frame: HeadFrame) => {
  const { head, headDirection, side, up } = frame;
  const radius = shape.headRadius * 0.16;
  for (const sign of [1, -1]) {
    const at = add(
      add(
        add(head, scale(headDirection, shape.headLength * 0.22)),
        scale(up, shape.headRadius * 0.42)
      ),
      scale(side, sign * shape.headRadius * 0.74)
    );
    builder.ellipsoid(
      at,
      headDirection,
      [radius, radius, radius],
      paintPart(shape, "eye", () => at),
      3,
      5
    );
  }
};

const addEar = (builder: CritterBuilder, shape: QuadShape, frame: HeadFrame, sign: number) => {
  const { head, headDirection, side, up } = frame;
  const base = add(
    add(
      add(head, scale(headDirection, -shape.headLength * 0.12)),
      scale(up, shape.headRadius * 0.78)
    ),
    scale(side, sign * shape.headRadius * 0.48)
  );
  const lie = shape.earLie * 1.3;
  const rise = add(scale(up, Math.cos(lie)), scale(headDirection, -Math.sin(lie) * 0.8));
  const outward = scale(side, sign * 0.25);
  const tip = add(base, scale(unit(add(rise, outward)), shape.earLength));
  builder.loft(
    [
      { at: base, height: shape.earWidth * 0.3, up: headDirection, width: shape.earWidth },
      {
        at: lerp3(base, tip, 0.6),
        height: shape.earWidth * 0.2,
        up: headDirection,
        width: shape.earWidth * 0.7
      },
      { at: tip, height: shape.earWidth * 0.08, up: headDirection, width: shape.earWidth * 0.12 }
    ],
    { endTip: shape.earWidth * 0.1, paint: paintPart(shape, "ear", () => tip), sides: EAR_SIDES }
  );
};


