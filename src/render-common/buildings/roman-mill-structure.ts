import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, Point3 } from "./building-recipe";
import { addRomanDoorSpandrels } from "./roman-door-profile";
import type { AddPart } from "./roman-resource-workshops";

/** Taper starts above the entrance; upper masonry narrows in both width and depth. */
export const addRomanMillStructure = (
  part: AddPart,
  parts: BuildingPart[],
  roof: (x: number, y: number, z: number, width: number, depth: number) => void,
  width: number,
  depth: number,
  height: number,
  detailed: boolean,
  frontWindow: boolean
) => {
  const lowerHeight = 1.18;
  const topWidth = width * 0.64,
    topDepth = depth * 0.66;
  const front = depth / 2;
  part("stone", [0, 0.18 + lowerHeight / 2, -front + 0.055], [width, lowerHeight, 0.11], 1);
  for (const side of [-1, 1]) {
    part(
      "stone",
      [side * (width / 2 - 0.055), 0.18 + lowerHeight / 2, 0],
      [0.11, lowerHeight, depth],
      1
    );
    part(
      "stone",
      [(side * (width / 2 + 0.23)) / 2, 0.18 + lowerHeight / 2, front],
      [width / 2 - 0.23, lowerHeight, 0.11],
      1
    );
  }
  addRomanDoorSpandrels(part, 0, front);
  part(
    "stone",
    [0, (0.95 + 0.18 + lowerHeight) / 2, front],
    [0.46, lowerHeight + 0.18 - 0.95, 0.11],
    1
  );
  const upperHeight = height - lowerHeight;
  const wall = (position: Point3, size: Point3, topScale: Point3, topOffset: Point3) => {
    parts.push({ shape: "box", surface: "stone", stage: 1, position, size, topScale, topOffset });
  };
  for (const side of [-1, 1]) {
    wall(
      [0, 0.18 + lowerHeight + upperHeight / 2, side * front + (side === -1 ? 0.055 : 0)],
      [width, upperHeight, 0.11],
      [topWidth / width, 1, 1],
      [0, 0, (-side * (depth - topDepth)) / 2]
    );
    wall(
      [side * (width / 2 - 0.055), 0.18 + lowerHeight + upperHeight / 2, 0],
      [0.11, upperHeight, depth],
      [1, 1, topDepth / depth],
      [(-side * (width - topWidth)) / 2, 0, 0]
    );
  }
  if (frontWindow)
    addRomanMillWindow(part, front, lowerHeight, upperHeight, (depth - topDepth) / 2, detailed);
  part("dark", [0, 0.19, 0], [width - 0.2, 0.025, depth - 0.2], 0);
  part("stone", [0, height + 0.21, 0], [topWidth + 0.05, 0.09, topDepth + 0.05], 3);
  roof(0, height + 0.27, 0, topWidth + 0.28, topDepth + 0.27);
};

/** Window centre above the ground: midway up the tapered front, between door arch and sail hub. */
const MILL_WINDOW_CENTRE = 1.78;

/**
 * Shuttered Roman window on the tapered tower front, lying in the leaning wall face. Its sill and
 * shutters stay well behind the sail arms, which turn in front of the hub.
 */
const addRomanMillWindow = (
  part: AddPart,
  front: number,
  lowerHeight: number,
  upperHeight: number,
  taper: number,
  detailed: boolean
) => {
  const lean = DMath.atan(taper / upperHeight);
  const rise = (MILL_WINDOW_CENTRE - 0.18 - lowerHeight) / upperHeight;
  const faceZ = front + 0.055 - rise * taper;
  const rotation: Point3 = [-lean, 0, 0];
  // Offsets along the wall (up the lean) and out of it (along the face normal).
  const onWall = (x: number, along: number, out: number): Point3 => [
    x,
    MILL_WINDOW_CENTRE + along * DMath.cos(lean) + out * DMath.sin(lean),
    faceZ - along * DMath.sin(lean) + out * DMath.cos(lean)
  ];
  part("dark", onWall(0, 0, 0.006), [0.2, 0.3, 0.02], 3, "box", rotation);
  if (!detailed) return;
  part("stone", onWall(0, -0.17, 0.025), [0.28, 0.04, 0.05], 3, "box", rotation);
  part("stone", onWall(0, 0.17, 0.012), [0.26, 0.04, 0.025], 3, "box", rotation);
  for (const side of [-1, 1])
    part("wood", onWall(side * 0.165, 0, 0.012), [0.11, 0.3, 0.025], 3, "box", rotation);
};
