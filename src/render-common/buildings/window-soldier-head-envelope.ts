import { DMath } from "../../shared/math/deterministic-math";
import type { WorkerNation } from "../workers/worker-unit";
import {
  GARRISON_HEAD_REACH, WINDOW_LEAN, type WindowSoldierFrame
} from "./military-window-slots";

/**
 * Measured head + helmet envelope of every nation's soldier body in its bind pose, in world units
 * relative to the feet: the highest and lowest point (`top`/`low`), the head bone, the lateral
 * half-width, and the forward/backward reach. Values are the worst case over the nation's body
 * variants and armour pieces, taken from the game-ready models (see the window-soldier receipt).
 */
export interface WindowSoldierHeadEnvelope {
  back: number;
  forward: number;
  /** Head bone height above the feet: the lever that swings the head out when the figure leans. */
  head: number;
  halfWidth: number;
  low: number;
  top: number;
}

export type WindowSoldierRank = "centurion" | "recruit" | "soldier";

/** Vertical clearance kept between the helmet and both the lintel and the sill. */
export const WINDOW_HEAD_VERTICAL_CLEARANCE = .004;
/** The box-corner envelope overstates a horn tip by a hair; this much side overlap is accepted. */
export const WINDOW_HEAD_SIDE_TOLERANCE = .002;
/** The standing lower body stays this far (world units) behind the hosting wall under the sill. */
export const WINDOW_SILL_CLEARANCE = .002;
/** Lean search resolution: 0.005 rad (0.3°) is below what the eye can see. */
export const WINDOW_POSE_STEP = .005;

const envelope = (top: number, low: number, head: number, halfWidth: number, forward: number, back: number):
WindowSoldierHeadEnvelope => ({ back, forward, halfWidth, head, low, top });

type EnvelopesByRank = Record<WindowSoldierRank, WindowSoldierHeadEnvelope>;

export const WINDOW_SOLDIER_HEAD_ENVELOPES: Record<WorkerNation, EnvelopesByRank> = {
  chinese: {
    centurion: envelope(1.208, .759, .833, .130, .166, .308),
    recruit: envelope(1.064, .817, .833, .099, .147, .116),
    soldier: envelope(1.133, .759, .833, .135, .152, .332)
  },
  indigenous: {
    centurion: envelope(1.328, .750, .847, .310, .303, .347),
    recruit: envelope(1.176, .840, .847, .149, .211, .189),
    soldier: envelope(1.177, .795, .847, .152, .213, .206)
  },
  japanese: {
    centurion: envelope(1.124, .759, .833, .169, .203, .177),
    recruit: envelope(1.090, .803, .833, .134, .161, .148),
    soldier: envelope(1.093, .784, .833, .148, .195, .154)
  },
  maya: {
    centurion: envelope(1.240, .743, .847, .213, .310, .318),
    recruit: envelope(1.121, .839, .847, .110, .198, .155),
    soldier: envelope(1.180, .761, .847, .158, .200, .274)
  },
  nubian: {
    centurion: envelope(1.260, .826, .847, .193, .229, .261),
    recruit: envelope(1.110, .827, .847, .104, .189, .156),
    soldier: envelope(1.155, .827, .847, .138, .194, .194)
  },
  persian: {
    centurion: envelope(1.134, .720, .863, .126, .161, .209),
    recruit: envelope(1.105, .860, .863, .093, .101, .147),
    soldier: envelope(1.161, .803, .863, .096, .128, .156)
  },
  roman: {
    centurion: envelope(1.239, .818, .863, .119, .131, .269),
    recruit: envelope(1.096, .823, .863, .104, .111, .169),
    soldier: envelope(1.114, .839, .863, .114, .142, .155)
  },
  viking: {
    centurion: envelope(1.327, .823, .860, .246, .204, .171),
    recruit: envelope(1.086, .831, .860, .102, .126, .151),
    soldier: envelope(1.186, .828, .860, .169, .152, .160)
  }
};

/** Presentation pose of one window soldier (world units; the shared slot never moves). */
export interface WindowSoldierFit {
  /** Outward plane of the feet (world units from the building centre). */
  feetOutward: number;
  /** True when every head, chest and lower-body constraint of the opening holds. */
  fits: boolean;
  /** Root tilt about the feet (radians): the figure leans out over the sill. */
  lean: number;
  /** Drawn root (feet) height above the building origin (world units). */
  rootY: number;
  /** Gap between the helmet side and the jamb (negative: the box-corner estimate overlaps). */
  sideClearance: number;
}

interface ProfilePoint { u: number; y: number }

/** Height of the neck bone above the feet: the head turns back up around it. */
const WINDOW_NECK_PIVOT = .78;
/** Share of the root lean the neck turns back, so the face looks out of the window, not down. */
export const WINDOW_LOOK_UP = .75;

/**
 * A head point (`height` above the feet, `forward` of the body axis) after the neck turns back and
 * the whole figure leans about the feet (`u` outward, `y` up).
 */
const headPoint = (height: number, forward: number, lean: number): ProfilePoint => {
  const look = -lean * WINDOW_LOOK_UP, above = height - WINDOW_NECK_PIVOT;
  const upright = height - (above - above * DMath.cos(look) + forward * DMath.sin(look));
  const ahead = forward * DMath.cos(look) + above * DMath.sin(look);
  const cos = DMath.cos(lean), sin = DMath.sin(lean);
  return { u: upright * sin + ahead * cos, y: upright * cos - ahead * sin };
};

/** Side-profile corners of the head + helmet box relative to the feet (`u` outward, `y` up). */
export const windowSoldierHeadCorners = (envelope: WindowSoldierHeadEnvelope, lean: number): ProfilePoint[] => {
  const corners: ProfilePoint[] = [];
  for (const height of [envelope.low, envelope.top]) for (const forward of [-envelope.back, envelope.forward])
    corners.push(headPoint(height, forward, lean));
  return corners;
};

/** The head bone (the head's centre) relative to the feet. */
export const windowSoldierHeadCentre = (envelope: WindowSoldierHeadEnvelope, lean: number) =>
  headPoint(envelope.head, 0, lean);

/** Vertical extent of the head + helmet relative to the feet. */
export const windowSoldierHeadSpan = (envelope: WindowSoldierHeadEnvelope, lean: number) => {
  const heights = windowSoldierHeadCorners(envelope, lean).map(corner => corner.y);
  return { bottom: Math.min(...heights), top: Math.max(...heights) };
};

/** A placed slot in world units: the drawn soldier keeps this facing and moves along it. */
export interface WindowSoldierPlacement { x: number; y: number; yaw: number; z: number }

/**
 * Drawn placement of a fitted window soldier from its shared slot: the feet move along the outward
 * axis to the fitted plane and the root to the fitted height. `groundY` is the building origin,
 * the same height reference `rootY` is measured from.
 */
export const placeWindowSoldier = (
  placed: WindowSoldierPlacement, groundY: number, frame: WindowSoldierFrame, fit: WindowSoldierFit
): WindowSoldierPlacement => {
  const legacyFeet = frame.headFront - GARRISON_HEAD_REACH * DMath.sin(WINDOW_LEAN);
  const shift = fit.feetOutward - legacyFeet;
  return { x: placed.x + DMath.sin(placed.yaw) * shift, y: groundY + fit.rootY, yaw: placed.yaw,
    z: placed.z + DMath.cos(placed.yaw) * shift };
};

/** Drawn head + helmet extents of a fitted soldier (world units; heights from the building origin). */
export const windowSoldierHeadBounds = (envelope: WindowSoldierHeadEnvelope, fit: WindowSoldierFit) => {
  const corners = windowSoldierHeadCorners(envelope, fit.lean);
  const outward = corners.map(corner => fit.feetOutward + corner.u);
  const heights = corners.map(corner => fit.rootY + corner.y);
  return { back: Math.min(...outward), bottom: Math.min(...heights), front: Math.max(...outward),
    headOutward: fit.feetOutward + windowSoldierHeadCentre(envelope, fit.lean).u,
    headY: fit.rootY + windowSoldierHeadCentre(envelope, fit.lean).y, top: Math.max(...heights) };
};
