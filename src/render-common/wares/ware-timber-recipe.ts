import { DMath } from "../../shared/math/deterministic-math";
import type { Point3 } from "../buildings/building-recipe";
import type { AddPart } from "../buildings/roman-resource-workshops";

interface TimberPlacement {
  position?: Point3;
  length?: number;
  yaw?: number;
}

// Both original bark LODs sample the cardinal radial vertices. After lying on its side,
// the lower bark radius is .506 diameters; the cut end supplies the upper .495 radius.
export const TIMBER_LOG_LOWER_RADIUS = .506;
export const TIMBER_LOG_VERTICAL_SPAN = 1.001;

const timberPart = (part: AddPart, placement: TimberPlacement): AddPart => {
  const [x, y, z] = placement.position ?? [0, 0, 0];
  const yaw = placement.yaw ?? 0;
  const cosine = DMath.cos(yaw),
    sine = DMath.sin(yaw);
  return (surface, position, size, stage, shape, rotation, tint) =>
    part(
      surface,
      [
        x + position[0] * cosine + position[2] * sine,
        y + position[1],
        z - position[0] * sine + position[2] * cosine
      ],
      size,
      stage,
      shape,
      [rotation?.[0] ?? 0, (rotation?.[1] ?? 0) + yaw, rotation?.[2] ?? 0],
      tint
    );
};

/** One bark-covered log, with visible cut growth rings at both ends, used in yards and cargo. */
export const addTimberLog = (
  part: AddPart,
  placement: TimberPlacement & { diameter?: number; detailed?: boolean } = {}
) => {
  const emit = timberPart(part, placement);
  const diameter = placement.diameter ?? 0.105,
    length = placement.length ?? 0.9;
  emit("bark", [0, 0, 0], [diameter, length, diameter], 3, "cylinder", [Math.PI / 2, 0, 0]);
  // Flush-cut branch collars sit on the sides, preserving the log's resting height.
  for (const side of placement.detailed === false ? [] : [-1, 1]) {
    const z = side * length * .23;
    emit("bark", [side * diameter * .39, diameter * .08, z],
      [diameter * .28, diameter * .2, diameter * .28], 3, "cylinder", [0, 0, Math.PI / 2]);
    emit("endgrain", [side * diameter * .495, diameter * .08, z],
      [diameter * .2, diameter * .008, diameter * .2], 3, "cylinder", [0, 0, Math.PI / 2]);
  }
  for (const side of [-1, 1]) {
    const endDiameter = diameter * (side < 0 ? 0.99 : 0.93);
    emit(
      "endgrain",
      [0, 0, side * (length / 2 + 0.001)],
      [endDiameter, 0.005, endDiameter],
      3,
      "cylinder",
      [Math.PI / 2, 0, 0]
    );
  }
};

/** A tied transport bundle; the sawmill stores the same boards in its inventory bays. */
export const addTimberPlanks = (
  part: AddPart,
  placement: TimberPlacement & { width?: number; thickness?: number; tied?: boolean; detailed?: boolean } = {}
) => {
  const emit = timberPart(part, placement);
  const length = placement.length ?? 0.78;
  const width = placement.width ?? 0.13,
    thickness = placement.thickness ?? 0.031;
  const spacing = placement.tied === false ? thickness : thickness * 1.13;
  for (let board = 0; board < 3; board++) {
    emit("wood", [0, (board - 1) * spacing, 0], [width, thickness, length], 3, "bevel-box");
    if (placement.detailed === false) continue;
    for (const side of [-1, 1])
      emit("endgrain", [0, (board - 1) * spacing, side * (length / 2 - .0003)],
        [width * .84, thickness * .78, .0006], 3);
  }
  if (placement.tied === false) return;
  for (const z of [-length * 0.31, length * 0.31])
    emit("rope", [0, 0, z], [width + 0.013, spacing * 2 + thickness + 0.009, 0.014], 3);
};
