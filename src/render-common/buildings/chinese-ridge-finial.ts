import type { BuildingPart, Point3 } from "./building-recipe";
import type { Add } from "./nation-kit-parts";

/** Small modeled ceramic ridge-end creature with a curled tail and an upturned head. */
export const addChineseRidgeFinial = (add: Add, point: Point3, yaw: number, surface: BuildingPart["surface"]) => {
  const local = (x: number, y: number, z: number): Point3 => [point[0] + Math.cos(yaw) * x + Math.sin(yaw) * z,
    point[1] + y, point[2] - Math.sin(yaw) * x + Math.cos(yaw) * z];
  add({ position: local(0, .045, 0), rotation: [0, yaw, 0], compactGeometry: true,
    shape: "sphere", radialSegments: 8, size: [.09, .1, .12], stage: 4, surface });
  add({ position: local(0, .12, .035), rotation: [0, yaw, 0], compactGeometry: true,
    shape: "sphere", radialSegments: 8, size: [.085, .075, .085], stage: 4, surface });
  add({ position: local(0, .115, .087), rotation: [-.35, yaw, 0], compactGeometry: true,
    shape: "bevel-box", size: [.055, .035, .075], stage: 4, surface });
  for (let index = 0; index < 4; index++) {
    const angle = index * Math.PI / 6;
    add({ position: local(0, .05 + Math.sin(angle) * .065, -.04 - Math.cos(angle) * .045),
      rotation: [angle, yaw, 0], compactGeometry: true, shape: "bevel-box",
      size: [.045 - index * .006, .045, .045], stage: 4, surface });
  }
};
