import type { CartLoadVariant } from "./cart-cargo-heap";

/** Pose of a drawn hand cart: its axle centre on the ground, facing `yaw`, front raised by `pitch`. */
export interface HandcartPose {
  pitch: number;
  x: number;
  y: number;
  yaw: number;
  z: number;
}

/** One hand cart to draw (pulled or parked) with its wheel turn and the items on its bed. */
export interface HandcartFrame extends HandcartPose {
  /** Items of `ware` lying on the bed. */
  count: number;
  /** How the load is drawn; chosen when `ware` or `count` changes (cart-cargo-heap.ts). */
  load: CartLoadVariant;
  /** The cart's carrier actor; stays the same while one carrier keeps the cart. */
  id: number;
  ware: string | null;
  /** Radians the wheels have turned (rolled distance / wheel radius). */
  wheelAngle: number;
}
