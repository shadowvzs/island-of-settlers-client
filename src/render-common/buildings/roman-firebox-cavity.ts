import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, Point3 } from "./building-recipe";
import { createWindowShadowPane } from "./building-window-shadows";

/** Convex arched opening, counter-clockwise from its lower left corner. */
export const fireboxOutline = (spring: number, segments: number): readonly (readonly [number, number])[] => {
  const points: [number, number][] = [[-.5, -.5], [.5, -.5]];
  for (let step = 0; step <= segments; step++) {
    const angle = step * Math.PI / segments;
    points.push([DMath.cos(angle) / 2, spring + DMath.sin(angle) * (.5 - spring)]);
  }
  return points;
};

/** Keep the original oven silhouettes and working anchors; remove actual masonry behind the fire mouth. */
export const addRomanFireboxCavity = (parts: BuildingPart[], id: number, detailed: boolean) => {
  if (id !== 32 && id !== 26) return;
  const mouthWidth = id === 32 ? .34 : .32;
  const mouth = parts.find(part => part.surface === "dark" && part.shape === "window-shadow" &&
    part.size[0] === mouthWidth && part.size[1] > .2);
  if (!mouth) return;
  const [x, y, front] = mouth.position, height = mouth.size[1], depth = .22;
  const spring = id === 32 ? -.142857142857 : -.1;
  const outline = fireboxOutline(spring, detailed ? 12 : 6);
  for (const part of parts) {
    if (part.surface !== "stone" || !["box", "sphere", "bevel-box"].includes(part.shape) ||
      Math.abs(part.position[0] - x) > .001 || part.size[0] < .5 || part.size[1] < .4) continue;
    const planes: [number, number, number, number][] = [];
    for (let index = 0; index < outline.length; index++) {
      const a = outline[index]!, b = outline[(index + 1) % outline.length]!;
      const ax = x + a[0] * mouthWidth, ay = y + a[1] * height;
      const nx = -(b[1] - a[1]) * height, ny = (b[0] - a[0]) * mouthWidth;
      planes.push([nx * part.size[0], ny * part.size[1], 0,
        nx * (part.position[0] - ax) + ny * (part.position[1] - ay)]);
    }
    planes.push([0, 0, -part.size[2], front + .03 - part.position[2]],
      [0, 0, part.size[2], part.position[2] - front + depth]);
    part.fireboxCut = planes;
  }
  // The reveals are actual opaque refractory masonry, open at the mouth, with a closed rear wall.
  parts.push({ position: [x, y, front - depth / 2], size: [mouthWidth, height, depth],
    surface: "stone", fireboxInterior: true, shape: "firebox-reveal", fireboxSpring: spring, stage: 2 });
  parts.push({ position: [x, y, front - depth - .008], size: [mouthWidth + .02, height + .02, .016],
    surface: "stone", fireboxInterior: true, shape: "bevel-box", stage: 2 });
  const index = parts.indexOf(mouth);
  const shadow: BuildingPart = { ...createWindowShadowPane(mouth, depth * .72, [0, 0, 1]),
    windowShadowContour: outline, windowShadowDecorative: true, fireboxMouth: true };
  // The original authored opening remains available to effects and slot metadata after the inset.
  shadow.windowOpeningPosition = [...mouth.position] as Point3;
  parts[index] = shadow;
};
