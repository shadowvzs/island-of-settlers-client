import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, Point3 } from "./building-recipe";
import type { RomanDoorDimensions } from "./roman-door-profile";
import type { AddPart } from "./roman-resource-workshops";

type RomanRoof = (x: number, y: number, z: number, width: number, depth: number) => void;
export interface RomanDesignContext {
  part: AddPart;
  parts: BuildingPart[];
  roof: RomanRoof;
  detailed: boolean;
  doorDimensions?: RomanDoorDimensions;
  entranceRoom?: { centerX: number; width: number };
}
/** Hollow stone rooms. The animated entrance retains the shared south-facing hinge contract. */
export const romanRoom = (
  context: RomanDesignContext,
  x: number,
  z: number,
  width: number,
  depth: number,
  height: number,
  entry?: number,
  base = 0.18,
  tiled = true
) => {
  const { part, roof } = context;
  if (entry !== undefined && !context.entranceRoom) context.entranceRoom = { centerX: x, width };
  const front = z + depth / 2;
  const doorWidth = context.doorDimensions?.width ?? .46;
  part("stone", [x, base + height / 2, z - depth / 2 + 0.055], [width, height, 0.11], 1);
  for (const side of [-1, 1])
    part("stone", [x + side * (width / 2 - 0.055), base + height / 2, z], [0.11, height, depth], 1);
  if (entry === undefined) part("stone", [x, base + height / 2, front], [width, height, 0.11], 1);
  else {
    for (const side of [-1, 1]) {
      const outer = x + (side * width) / 2,
        edge = entry + side * doorWidth / 2;
      part(
        "stone",
        [(outer + edge) / 2, base + height / 2, front],
        [Math.abs(outer - edge), height, 0.11],
        1
      );
      const jambOffset = doorWidth > .46 ? .09 : .04;
      part("stone", [entry + side * (doorWidth / 2 + jambOffset), 0.56, front + 0.04], [.075, .76, .12], 2);
    }
    if (base + height > 0.95)
      part(
        "stone",
        [entry, (base + height + 0.95) / 2, front],
        [doorWidth, base + height - 0.95, 0.11],
        1
      );
    part("stone", [entry, 0.98, front + 0.04], [doorWidth + .16, .1, .12], 2);
  }
  part("dark", [x, base + 0.012, z], [width - 0.15, 0.024, depth - 0.15], 0);
  part("stone", [x, base + height + 0.035, z], [width + 0.04, 0.07, depth + 0.04], 2);
  if (tiled) roof(x, base + height + 0.1, z, width + 0.22, depth + 0.22);
};
export const romanCanopy = (
  context: RomanDesignContext,
  x: number,
  z: number,
  width: number,
  depth: number,
  height: number
) => {
  for (const side of [-1, 1])
    for (const end of [-1, 1])
      context.part(
        "stone",
        [x + side * width * 0.42, 0.18 + height / 2, z + end * depth * 0.4],
        [0.1, height, 0.1],
        2,
        "cylinder"
      );
  context.roof(x, height + 0.2, z, width, depth);
};
export const romanBench = (
  part: AddPart,
  x: number,
  z: number,
  width = 0.6,
  depth = 0.4,
  top = 0.65
) => {
  part("wood", [x, top, z], [width, 0.06, depth], 3);
  for (const side of [-1, 1])
    for (const end of [-1, 1])
      part(
        "wood",
        [x + side * width * 0.39, (top + 0.15) / 2, z + end * depth * 0.36],
        [0.05, top - 0.15, 0.05],
        2
      );
};
export const romanBarrel = (
  part: AddPart,
  x: number,
  z: number,
  detailed: boolean,
  radius = 0.19
) => {
  part("wood", [x, 0.39, z], [radius * 2, 0.42, radius * 2], 3, "sphere");
  part("endgrain", [x, 0.584, z], [radius * 1.55, 0.025, radius * 1.55], 3, "cylinder");
  for (const y of [0.25, 0.52])
    part("iron", [x, y, z], [radius * 1.85, 0.028, radius * 1.85], 3, "cylinder");
  if (detailed)
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5;
      part(
        "wood",
        [x + DMath.cos(a) * radius * 0.89, 0.385, z + DMath.sin(a) * radius * 0.89],
        [0.014, 0.3, 0.022],
        3,
        "box",
        [0, -a, 0]
      );
    }
};
export const romanFence = (
  part: AddPart, x: number, z: number, width: number, depth: number, openBack = false
) => {
  for (const side of [-1, 1]) {
    for (const end of [-1, 1])
      part("wood", [x + (side * width) / 2, 0.46, z + (end * depth) / 2], [0.065, 0.56, 0.065], 2);
    for (const y of [0.34, 0.6]) {
      if (!openBack || side > 0)
        part("wood", [x, y, z + (side * depth) / 2], [width, 0.035, 0.04], 2);
      part("wood", [x + (side * width) / 2, y, z], [0.04, 0.035, depth], 2);
    }
  }
};
export const romanLadder = (
  part: AddPart,
  x: number,
  z: number,
  top: number,
  bottom = 0.18,
  step = 0.15
) => {
  for (const side of [-1, 1])
    part("wood", [x + side * 0.12, (top + bottom) / 2, z], [0.035, top - bottom, 0.04], 3);
  for (let y = bottom + 0.1; y < top; y += step) part("wood", [x, y, z], [0.25, 0.027, 0.035], 3);
};
export const romanChimney = (part: AddPart, x: number, z: number, top: number) => {
  part("stone", [x, (top + 0.18) / 2, z], [0.24, top - 0.18, 0.25], 2);
  part("stone", [x, top, z], [0.3, 0.07, 0.31], 3);
  part("dark", [x, top + 0.04, z], [0.19, 0.01, 0.2], 3, "window-shadow");
};

/** Replace a solid wall rectangle with four jamb/header pieces around a real opening. */
export const romanWallOpening = (
  context: RomanDesignContext,
  wall: BuildingPart,
  center: number,
  bottom: number,
  width: number,
  height: number,
  side = false
) => {
  const axis = side ? 2 : 0;
  const wallLeft = wall.position[axis] - wall.size[axis] / 2;
  const wallRight = wall.position[axis] + wall.size[axis] / 2;
  const wallBottom = wall.position[1] - wall.size[1] / 2;
  const wallTop = wall.position[1] + wall.size[1] / 2;
  context.parts.splice(context.parts.indexOf(wall), 1);
  const rectangle = (left: number, right: number, low: number, high: number) => {
    // A sill flush with the wall foot leaves no masonry: skip the zero-height sliver.
    if (right - left < 1e-6 || high - low < 1e-6) return;
    const position: Point3 = [...wall.position];
    const size: Point3 = [...wall.size];
    position[axis] = (left + right) / 2;
    position[1] = (low + high) / 2;
    size[axis] = right - left;
    size[1] = high - low;
    context.part("stone", position, size, wall.stage);
  };
  rectangle(wallLeft, center - width / 2, wallBottom, wallTop);
  rectangle(center + width / 2, wallRight, wallBottom, wallTop);
  rectangle(center - width / 2, center + width / 2, wallBottom, bottom);
  rectangle(center - width / 2, center + width / 2, bottom + height, wallTop);
};
