import { DMath } from "../../shared/math/deterministic-math";
import { ROAD_WIDTH, type RoadPoint, type RoadSegment } from "../../shared/settlement/road-types";
import { TOOL_WARES } from "../wares/ware-catalog";
import { CART_CARGO_LAYOUTS } from "./cart-cargo-layouts";

const isTool = (ware: string) => (TOOL_WARES as ReadonlySet<string>).has(ware);

/** Initial prototype bounds in world metres/cells; includes the carrier ahead of the handles. */
/** `wheelHalfGauge`: each wheel's distance from the cart's centre line (0.6 m gauge). */
export const HANDCART = Object.freeze({ load: 12, maxItems: 6, width: .72, length: 1.92,
  wheelRadius: .235, wheelHalfGauge: .299, gripHeight: .61, carrierOffset: .74, clearance: .06 });
/** Ground envelope of the authored frame: narrow bed rear, wider wheels, then pulling shafts. */
export const HANDCART_FOOTPRINT = [
  { halfWidth: .245, z: -.43 }, { halfWidth: .36, z: -.27 },
  { halfWidth: .36, z: .2 }, { halfWidth: .245, z: .32 }, { halfWidth: .215, z: 1.05 }
] as const;
/** Middle of each shaft's hand grip in the cart frame (left grip; the right one mirrors x). */
export const HANDCART_GRIP = Object.freeze({ x: .19, y: .6095, z: .965 });
export const CART_EXCLUDED_WARES = new Set(["boat", "pig"]);
/** Production output of the Sawmill's cart cycle (never a ware: the cart is pulled home, not carried). */
export const HANDCART_OUTPUT = "handcart";
/** Model-audited capacity: every ware keeps a fixed visual size within the cart's bed. */
export const CART_WARE_LOAD: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(CART_CARGO_LAYOUTS).map(([ware, layout]) => [ware, HANDCART.load / layout.count]));
const TOOL_LOAD = 2;
const DEFAULT_LOAD = 3;

/** Every leg must be covered by upgraded edges; speedAt alone would accept broken routes. */
export const isUpgradedCartRoute = (points: readonly RoadPoint[], segments: readonly RoadSegment[]) => {
  if (points.length < 2) return false;
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1]!, end = points[index]!;
    const length = DMath.hypot(end.x - start.x, end.z - start.z);
    if (length < .001) continue;
    const count = Math.ceil(length / .1);
    for (let step = 0; step <= count; step++) {
      const point = { x: start.x + (end.x - start.x) * step / count,
        z: start.z + (end.z - start.z) * step / count };
      if (!segments.some(segment => {
        if (segment.tier === "dirt" || segment.doorway || segment.preview) return false;
        const dx = segment.end.x - segment.start.x, dz = segment.end.z - segment.start.z;
        const squared = dx * dx + dz * dz;
        if (squared < 1e-8) return false;
        const t = ((point.x - segment.start.x) * dx + (point.z - segment.start.z) * dz) / squared;
        return t >= -.0001 && t <= 1.0001 &&
          DMath.hypot(point.x - segment.start.x - dx * t, point.z - segment.start.z - dz * t) < .001;
      })) return false;
    }
  }
  return true;
};

/** Cart centre for a puller standing at (x, z) and facing `yaw` (forward = sin, cos). */
export const cartCentreBehind = (x: number, z: number, yaw: number) => ({
  x: x - DMath.sin(yaw) * HANDCART.carrierOffset,
  z: z - DMath.cos(yaw) * HANDCART.carrierOffset
});
/** Where the puller stands to take the shafts of a cart parked at (x, z) facing `yaw`. */
export const cartHitchPoint = (x: number, z: number, yaw: number) => ({
  x: x + DMath.sin(yaw) * HANDCART.carrierOffset,
  z: z + DMath.cos(yaw) * HANDCART.carrierOffset
});

export const cartWareLoad =(ware: string) => CART_WARE_LOAD[ware] ?? (isTool(ware) ? TOOL_LOAD : DEFAULT_LOAD);

/**
 * How many items of one ware a cart takes on its own; the handcart talent's `bonus` share raises it,
 * rounded down (owner 2026-10-20). The cart model and its drawn load stay those of the base capacity.
 */
export const cartCapacityFor = (ware: string, bonus = 0) => {
  if (CART_EXCLUDED_WARES.has(ware)) return 0;
  const base = Math.min(HANDCART.maxItems, Math.floor(HANDCART.load / cartWareLoad(ware)));
  return Math.floor(base * (1 + bonus) + 1e-9);
};

export const cartLoadFits = (wares: readonly string[]) => wares.length <= HANDCART.maxItems &&
  wares.every(ware => !CART_EXCLUDED_WARES.has(ware)) &&
  wares.reduce((sum, ware) => sum + cartWareLoad(ware), 0) <= HANDCART.load;
/** Width side by side carts need, with a clearance at both kerbs and between them. */
export const cartPassingWidth = (carts = 2) => carts * HANDCART.width + (carts + 1) * HANDCART.clearance;
export const cartFitsRoad = (width = ROAD_WIDTH) => width >= HANDCART.width + HANDCART.clearance;
/**
 * Carts keep right on 1.2 stone roads (owner, 2026-10-14): opposing carts' centres are a cart
 * width plus clearance apart, so they pass without touching; the outer wheel runs just past
 * the paving edge. On dirt they keep the road centre.
 */
export const CART_STONE_LANE = (HANDCART.width + HANDCART.clearance) / 2;
/** Road-centre half-width two passing carts occupy: lane offset, half a cart and its clearance (0.81). */
export const TWO_LANE_CART_HALF_WIDTH = CART_STONE_LANE + HANDCART.width / 2 + HANDCART.clearance;
