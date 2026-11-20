import { TAP_MAX_MOVE_PIXELS } from "./pointer-gestures";

/**
 * Settings "Mouse rotation" (owner decision 2026-11-13, military controls §5.4): the mouse button whose
 * drag turns the camera. Middle drag always turned the view; "right" adds the right button (behind a
 * dead zone, so a right tap stays an order), "off" suits touchpads (Q / E and the camera pad remain).
 */
export type MouseRotation = "middle" | "off" | "right";

/** Settings order. */
export const MOUSE_ROTATIONS: readonly MouseRotation[] = ["middle", "right", "off"];
export const DEFAULT_MOUSE_ROTATION: MouseRotation = "middle";

export type CameraDragMode = "pan" | "rotate";

const PRIMARY_BUTTON = 0;
const MIDDLE_BUTTON = 1;
const RIGHT_BUTTON = 2;

export const isMouseRotation = (value: unknown): value is MouseRotation =>
  (MOUSE_ROTATIONS as readonly unknown[]).includes(value);

const rotatesWith = (button: number, rotation: MouseRotation) => {
  if (rotation === "off") return false;
  if (button === MIDDLE_BUTTON) return true;
  return button === RIGHT_BUTTON && rotation === "right";
};

/**
 * What a drag of `button` does: the left button pans (or draws the army box while the primary drag
 * selects); the rotation button turns the view, or pans instead while the left drag selects.
 * Null: the drag leaves the camera alone (a right drag with the default setting).
 */
export const cameraDragMode = (
  button: number, rotation: MouseRotation, primaryDragSelects: boolean
): CameraDragMode | null => {
  if (button === PRIMARY_BUTTON) return primaryDragSelects ? null : "pan";
  if (!rotatesWith(button, rotation)) return null;
  return primaryDragSelects ? "pan" : "rotate";
};

/** CSS pixels a drag must travel before it moves the camera: right drags wait out the tap radius. */
export const cameraDragDeadZone = (button: number) => button === RIGHT_BUTTON ? TAP_MAX_MOVE_PIXELS : 0;
