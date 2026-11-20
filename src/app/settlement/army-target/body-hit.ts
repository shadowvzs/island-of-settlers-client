import type { ScreenPoint } from "../army-selection";

type Project = (x: number, y: number, z: number) => ScreenPoint;

/** A body the right click may hit: its feet, and whether it rides (a taller hit volume). */
export interface HitBody { mounted?: boolean; uid: number; x: number; y: number; z: number }

/** World height of a soldier's hit volume above its feet, on foot and on a horse. */
const BODY_HEIGHT = 1.7;
const MOUNTED_BODY_HEIGHT = 2.3;
/** The volume's half width as a share of its on-screen height (a person is about a third as wide as tall). */
const HALF_WIDTH_SHARE = .18;
/**
 * The on-screen half width bounds (CSS px) of the hit volume: the minimum keeps a far body clickable, the maximum
 * keeps "on the body" tight (owner 2026-11-17: on the body targets the unit, near it attack-moves). A finger gets
 * a wider band than a mouse.
 */
export const BODY_HIT_RADIUS = { mouse: { max: 10, min: 4 }, touch: { max: 18, min: 14 } } as const;
export type BodyHitRadius = (typeof BODY_HIT_RADIUS)[keyof typeof BODY_HIT_RADIUS];

/** Distance from `point` to the screen segment `from`-`to`. */
const segmentDistance = (point: ScreenPoint, from: ScreenPoint, to: ScreenPoint) => {
  const dx = to.x - from.x, dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  if (length === 0) return Math.hypot(point.x - from.x, point.y - from.y);
  const along = ((point.x - from.x) * dx + (point.y - from.y) * dy) / length;
  const share = Math.max(0, Math.min(1, along));
  return Math.hypot(point.x - (from.x + dx * share), point.y - (from.y + dy * share));
};

/** How far outside the body's projected capsule `point` lies (0 or less: on the body). */
const bodyMiss = (body: HitBody, project: Project, point: ScreenPoint, radius: BodyHitRadius) => {
  const feet = project(body.x, body.y, body.z);
  const head = project(body.x, body.y + (body.mounted ? MOUNTED_BODY_HEIGHT : BODY_HEIGHT), body.z);
  const height = Math.hypot(head.x - feet.x, head.y - feet.y);
  const halfWidth = Math.min(radius.max, Math.max(radius.min, height * HALF_WIDTH_SHARE));
  return segmentDistance(point, feet, head) - halfWidth;
};

/**
 * The body the point actually lies on (its projected capsule, by the renderer's last-frame camera), the most
 * central one when several overlap; undefined when the point is only near a body.
 */
export const bodyHitAt = <Body extends HitBody>(
  bodies: readonly Body[], project: Project, point: ScreenPoint, radius: BodyHitRadius = BODY_HIT_RADIUS.mouse
) => {
  let hit: Body | undefined, best = 0;
  for (const body of bodies) {
    const miss = bodyMiss(body, project, point, radius);
    if (miss > 0 || (hit && miss >= best)) continue;
    hit = body; best = miss;
  }
  return hit;
};
