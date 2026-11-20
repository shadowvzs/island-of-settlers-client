import type { Point3 } from "./building-recipe";

/** Recipe-local solid volume; ellipses use the same min/max envelope with an elliptical plan. */
export interface BuildingNavigationVolume {
  id?: string;
  min: Point3;
  max: Point3;
  shape?: "box" | "ellipse";
  /** Rotation around the envelope's own centre in the recipe's horizontal plane. */
  yaw?: number;
}

/** A real opening connecting authored exterior/room routes; it never cuts a hole through a solid part. */
export interface BuildingNavigationPassage {
  id: string;
  kind: "door" | "gate";
  from: Point3;
  to: Point3;
  width: number;
  /** Only open exterior gates are public. Interior doors retain actor phase/queue admission. */
  public?: boolean;
}

/** Shared visual/physical authoring contract, in recipe units before the existing fixed plot scale. */
export interface BuildingNavigationMetadata {
  /** Explicit room volumes replace inferred rooms; public navigation always excludes their interiors. */
  interiors?: readonly BuildingNavigationVolume[];
  passages?: readonly BuildingNavigationPassage[];
  /** Extra static obstacles supplement the actual structural/equipment parts, never replace them. */
  staticObstacles?: readonly BuildingNavigationVolume[];
}
