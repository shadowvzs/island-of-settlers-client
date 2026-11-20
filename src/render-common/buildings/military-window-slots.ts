import { DMath } from "../../shared/math/deterministic-math";
import { WORKER_HEIGHT } from "../workers/worker-dimensions";
import type { BuildingPart, Point3 } from "./building-recipe";
import { getRomanPartBounds, getRomanPartSliceBounds } from "./building-recipe-fit";

/** Windows narrower than this are arrow slits: nobody leans out of them. */
const MIN_WINDOW_WIDTH = .15;
/** Head centre above the feet, as a share of the figure's height. */
const HEAD_HEIGHT = .88;
/** Forward tilt of a window soldier: the hips stay behind the wall, head and shoulders lean out. */
export const WINDOW_LEAN = .22;
/** How far the head centre sits in front of the window (or of jambs framing it). */
const HEAD_OUTSIDE = .02;
/** Only parts this close behind the window can frame it (walls, jambs, shutters). */
const FRAME_DEPTH = .1;
export const GARRISON_HEAD_REACH = WORKER_HEIGHT * HEAD_HEIGHT;
/** The head sits in the upper part of the opening, so the chest stays behind the sill. */
const HEAD_RAISE = .08;
/** Opaque parts thinner than this are frames, trims or panes, never a hosting wall. */
const MIN_WALL_THICKNESS = .06;
/** A hosting wall face lies this close behind its pane; farther parts belong to another structure. */
const MAX_WALL_SETBACK = .08;
/** A wall may stand this far proud of the old pane (a real recessed opening). */
const MAX_WALL_PROUD = .08;
/**
 * How far below the sill the hiding wall is measured (recipe units): the bent soldier's feet can
 * stand up to ~0.8 world units below the sill, so the wall must be sampled across that whole span.
 */
const LOWER_BODY_SPAN = .6;
/** Height samples across the lower-body span: log walls are stacks of shorter parts. */
const LOWER_BODY_SAMPLES = 16;
/** Half-depth of the parked legs, boots and hanging gear below a window (world units; measured). */
export const GARRISON_LOWER_BODY_HALF_DEPTH = .12;
/** Extra setback behind stacked wall parts (log courses, banded towers), whose seams expose more. */
const GARRISON_WALL_SEAM_MARGIN = .05;
/** Faces this close (recipe units) to the deepest one belong to the same recessed wall surface. */
const SEAM_FACE_TOLERANCE = .01;

const isLeanWindow = (part: BuildingPart) => part.surface === "dark" && !part.stock && !part.windowShadowDecorative && part.size[1] > .15 &&
  Math.min(...part.size) < .06 && Math.max(part.size[0], part.size[2]) >= MIN_WINDOW_WIDTH;

const overlaps = (min: number, max: number, low: number, high: number) => min < high && max > low;

/** Outermost face (recipe units, along the window's outward axis) of the window and the parts framing it. */
const windowFront = (window: BuildingPart, parts: readonly BuildingPart[], across: 0 | 2, sign: number) => {
  const opening = getRomanPartBounds(window), along = across === 0 ? 2 : 0;
  let front = sign * window.position[across]!;
  // The original pane's own thin outer face participated in this legacy projection too.
  if (window.windowShadow) {
    const outer = sign > 0 ? opening.max[across] : -opening.min[across];
    if (outer - front < FRAME_DEPTH) front = Math.max(front, outer);
  }
  for (const part of parts) {
    const { max, min } = getRomanPartBounds(part);
    if (!overlaps(min[1]!, max[1]!, opening.min[1]!, opening.max[1]!)) continue;
    if (!overlaps(min[along]!, max[along]!, opening.min[along]!, opening.max[along]!)) continue;
    const outer = sign > 0 ? max[across]! : -min[across]!;
    if (outer > front && outer - front < FRAME_DEPTH) front = outer;
  }
  return front;
};

/** Frontmost hosting-wall face at one height under a window (recipe units) and its part. */
const wallFaceAt = (
  parts: readonly BuildingPart[], opening: ReturnType<typeof getRomanPartBounds>, across: 0 | 2, along: 0 | 2,
  sign: number, paneOuter: number, y: number
) => {
  let front = -Infinity, face: BuildingPart | undefined;
  for (const part of parts) {
    if (part.surface === "dark" || part.windowShadow || part.stock) continue;
    const bounds = getRomanPartBounds(part);
    if (bounds.min[1]! > y || bounds.max[1]! < y) continue;
    const { max, min } = getRomanPartSliceBounds(part, y);
    if (!overlaps(min[along]!, max[along]!, opening.min[along]!, opening.max[along]!)) continue;
    if (max[across]! - min[across]! < MIN_WALL_THICKNESS) continue;
    const outer = sign > 0 ? max[across]! : -min[across]!;
    if (outer < paneOuter - MAX_WALL_SETBACK || outer > paneOuter + MAX_WALL_PROUD) continue;
    if (outer > front) { front = outer; face = part; }
  }
  return { face, front };
};

/** Frontmost hosting face at one height under a window (recipe units): `drop` below the sill. */
export interface WindowWallSample { drop: number; front: number }

/**
 * Hosting faces across the whole parked lower body under a window (recipe units). Every height
 * between the sill and the feet is sampled, so stacked log courses, tapered towers, sill blocks and
 * proud window surrounds are measured where they actually exist. `low` is the deepest such face. A
 * recessed face built from several parts is flagged (`segmented`): the seams between log courses
 * sit deeper than the outer silhouette, so the body needs more room. Falls back to the pane face.
 */
const windowWall = (window: BuildingPart, parts: readonly BuildingPart[], across: 0 | 2, sign: number) => {
  const opening = getRomanPartBounds(window), along = across === 0 ? 2 : 0;
  const paneOuter = sign > 0 ? opening.max[across]! : -opening.min[across]!;
  const sill = window.position[1]! - window.size[1] / 2;
  const faces: (WindowWallSample & { face: BuildingPart })[] = [];
  for (let sample = 0; sample <= LOWER_BODY_SAMPLES; sample++) {
    const drop = LOWER_BODY_SPAN * sample / LOWER_BODY_SAMPLES;
    const { face, front } = wallFaceAt(parts, opening, across, along, sign, paneOuter, sill - drop);
    if (face) faces.push({ drop, face, front });
  }
  if (!faces.length) return { low: paneOuter, profile: [{ drop: 0, front: paneOuter }], segmented: false };
  const low = Math.min(...faces.map(({ front }) => front));
  // Seams only matter where several parts (log courses, wall bands) form that recessed face itself.
  const recessed = new Set(faces.filter(({ front }) => front - low < SEAM_FACE_TOLERANCE).map(({ face }) => face));
  return { low, profile: faces.map(({ drop, front }) => ({ drop, front })), segmented: recessed.size > 1 };
};

/** Face out of the window: across the x axis (±90°) or the z axis (0 or 180°). */
const getWindowSlotYaw = (across: number, sign: number) => {
  if (across === 0) return sign * Math.PI / 2;
  return sign > 0 ? 0 : Math.PI;
};

export interface WindowGarrisonAnchor {
  across: 0 | 2;
  front: number;
  /** Height of the opening (recipe units). */
  openingHeight: number;
  /** Width of the opening along the wall (recipe units). */
  openingWidth: number;
  /** Outer face of the opening itself: the recessed dark insert behind a window soldier. */
  insertFront: number;
  position: Point3;
  sign: number;
  /** World-facing plane of the hosting wall across the whole parked lower body (recipe units). */
  wallLow: number;
  /** Frontmost hosting face at each sampled height under the sill (recipe units). */
  wallProfile: readonly WindowWallSample[];
  /** The wall is built from several parts (log courses, banded towers); its seams sit deeper. */
  wallSegmented: boolean;
}

/** Geometry-independent window contracts survive replacing a dark pane with a real opening. */
export const windowGarrisonAnchors = (parts: readonly BuildingPart[]): WindowGarrisonAnchor[] =>
  parts.filter(isLeanWindow).map(part => {
    const window = part.windowOpeningPosition ? { ...part, position: part.windowOpeningPosition,
      size: part.windowOpeningSize ?? part.size } : part;
    const across = window.size[0] < window.size[2] ? 0 : 2;
    const sign = Math.sign(window.position[across]!) || 1;
    const bounds = getRomanPartBounds(window), along = across === 0 ? 2 : 0;
    const wall = windowWall(window, parts, across, sign);
    return { across, front: windowFront(window, parts, across, sign),
      insertFront: sign > 0 ? bounds.max[across]! : -bounds.min[across]!, openingHeight: window.size[1],
      openingWidth: bounds.max[along]! - bounds.min[along]!, position: [...window.position], sign,
      wallLow: wall.low, wallProfile: wall.profile, wallSegmented: wall.segmented };
  });

/** Where a rendered window soldier sits relative to its opening (world units). */
export interface WindowSoldierFrame {
  /** Outward face of the window plane the legacy head sits on (world units from the centre). */
  headFront: number;
  /** Outer face of the recessed dark insert: the drawn head, face and chest stay in front of it. */
  insertFront: number;
  /** Top of the opening: the head stays below it. */
  lintel: number;
  /** Half-depth of the torso and legs that must stay behind the wall below the sill (seams add margin). */
  lowerBodyDepth: number;
  /** Width of the opening between the jambs: the helmet stays between them. */
  openingWidth: number;
  /** Bottom of the opening: the wall below it hides the lowered body. */
  sill: number;
  /** Deepest hosting wall face across the whole parked lower body. */
  wallLow: number;
  /** Frontmost hosting face at each sampled height under the sill (`y` from the building origin). */
  wallProfile: readonly { front: number; y: number }[];
}

export interface WindowGarrisonSlot { kind: "window"; lean: number; position: Point3; yaw: number }
export interface ProjectedWindowSlot { frame: WindowSoldierFrame; slot: WindowGarrisonSlot }

/**
 * The shared slot keeps the legacy head plane (simulation positions and replay hashes stay put);
 * the frame carries the drawn opening, its insert and the wall that hides the lower body.
 */
export const projectWindowGarrisonSlots = (
  anchors: readonly WindowGarrisonAnchor[], scale: number
): ProjectedWindowSlot[] =>
  anchors.map(({ across, front, insertFront, openingHeight, openingWidth, position: anchor, sign, wallLow,
    wallProfile, wallSegmented }) => {
    const position = anchor.map(value => value * scale) as Point3;
    const head = front * scale + HEAD_OUTSIDE, headY = anchor[1] * scale + HEAD_RAISE;
    const sill = (anchor[1] - openingHeight / 2) * scale, lintel = sill + openingHeight * scale;
    position[across] = sign * (head - GARRISON_HEAD_REACH * DMath.sin(WINDOW_LEAN));
    position[1] = headY - GARRISON_HEAD_REACH * DMath.cos(WINDOW_LEAN);
    const frame: WindowSoldierFrame = { headFront: head, insertFront: insertFront * scale, lintel,
      lowerBodyDepth: GARRISON_LOWER_BODY_HALF_DEPTH + (wallSegmented ? GARRISON_WALL_SEAM_MARGIN : 0),
      openingWidth: openingWidth * scale, sill, wallLow: wallLow * scale,
      wallProfile: wallProfile.map(({ drop, front: face }) => ({ front: face * scale, y: sill - drop * scale })) };
    return { frame, slot: { kind: "window", lean: WINDOW_LEAN, position, yaw: getWindowSlotYaw(across, sign) } };
  });
