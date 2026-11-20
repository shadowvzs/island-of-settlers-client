import type { Point3 } from "./building-recipe";
import { CHINESE_CLOUD_CURLS, CHINESE_CLOUD_OUTLINE,sampleChineseCloudCurve } from "./chinese-cloud-pattern";
import type { Add } from "./nation-kit-parts";

/** Matte ochre cloud paintings occupy the two free front wall panels below the upper windows. */
export const addChineseHeadquartersClouds = (add: Add, detailed: boolean) => {
  const slices = detailed ? 7 : 3;
  for (const side of [-1, 1]) {
    const centre: Point3 = [side * .36, 1.75, .6165], scaleX = .48, scaleY = .32;
    const boundary = CHINESE_CLOUD_OUTLINE.flatMap(curve => Array.from({ length: slices }, (_, index) =>
      sampleChineseCloudCurve(curve, index / slices)));
    for (let index = 0; index < boundary.length; index++) {
      const a = boundary[index]!, b = boundary[(index + 1) % boundary.length]!;
      let ax = a[0] * scaleX, ay = a[1] * scaleY, bx = b[0] * scaleX, by = b[1] * scaleY;
      if ((bx - ax) * -ay - (by - ay) * -ax < 0) [ax, ay, bx, by] = [bx, by, ax, ay];
      const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
      const ux = dx / length, uy = dy / length, nx = -uy, ny = ux;
      const mx = (ax + bx) / 2, my = (ay + by) / 2, height = -mx * nx - my * ny;
      add({ architecture: true, position: [centre[0] + mx + nx * height / 2,
        centre[1] + my + ny * height / 2, centre[2]], rotation: [0, 0, Math.atan2(dy, dx)],
      shape: "cloud-paint", size: [length, height, .001], topOffset: [-mx * ux - my * uy, 0, 0],
      stage: 2, surface: "paint", tint: [.78, .64, .42] });
    }
    for (const curve of CHINESE_CLOUD_CURLS) for (let index = 0; index < slices; index++) {
      const a = sampleChineseCloudCurve(curve, index / slices), b = sampleChineseCloudCurve(curve, (index + 1) / slices);
      const dx = (b[0] - a[0]) * scaleX, dy = (b[1] - a[1]) * scaleY;
      add({ architecture: true, position: [centre[0] + (a[0] + b[0]) * scaleX / 2,
        centre[1] + (a[1] + b[1]) * scaleY / 2, centre[2] + .0006],
      rotation: [0, 0, Math.atan2(dy, dx)], shape: "paint-stroke", stage: 2,
      size: [Math.hypot(dx, dy) + .002, .008, .001], surface: "paint", tint: [.67, .43, .15] });
    }
  }
};
