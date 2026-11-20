import type { Point3 } from "./building-recipe";

/** One physical support/ground bay; unrelated tables, racks and different support planes stay separate. */
export interface BuildingStockBay {
  id: string;
  kind: "input" | "output";
  /** A mixed bay shares one ordered capacity across these wares. */
  wares: readonly string[];
  /** Existing inventory IDs owned by this bay; new slots append rather than reorder existing IDs. */
  slots?: readonly number[];
  /** Usable recipe-local envelope of its support, excluding walking/door/work lanes. */
  bounds?: { min: Point3; max: Point3 };
  supportY?: number;
  yaw?: number;
  columns?: number;
  rows?: number;
  layers?: number;
  /** Opt-in physical limit, published to gameplay only after the complete packing/access audit. */
  capacity?: number;
  /** Hanging equipment and specially supported fixtures retain their original authored layout. */
  packing?: "preserve" | "compact";
}
