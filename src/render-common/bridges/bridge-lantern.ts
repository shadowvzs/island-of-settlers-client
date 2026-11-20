import type { AddBridgePart } from "./bridge-recipe";

/**
 * A small iron-framed lantern standing on a post head at `base`: foot plate, amber panes, corner bars
 * (High) and a pyramid cap. Decoration only: it is never a light source.
 */
export const addBridgeLantern = (add: AddBridgePart, detailed: boolean, x: number, base: number, across: number) => {
  add({ position: [x, base + 0.015, across], shape: "box", size: [0.17, 0.03, 0.17], surface: "iron" });
  add({ position: [x, base + 0.065, across], radialSegments: 6, shape: "cylinder", size: [0.05, 0.07, 0.05],
    surface: "iron" });
  add({ position: [x, base + 0.18, across], shape: "box", size: [0.13, 0.16, 0.13], surface: "amber" });
  if (detailed) for (const corner of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) add({
    // Corner bars stand on the foot plate and carry the cap.
    position: [x + corner[0] * 0.06, base + 0.145, across + corner[1] * 0.06], shape: "box",
    size: [0.02, 0.23, 0.02], surface: "iron" });
  add({ position: [x, base + 0.31, across], radialSegments: 4, rotation: [0, Math.PI / 4, 0], shape: "cone",
    size: [0.19, 0.1, 0.19], surface: "iron" });
};
