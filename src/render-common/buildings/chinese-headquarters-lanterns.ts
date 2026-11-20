import type { Point3 } from "./building-recipe";
import type { Add } from "./nation-kit-parts";

/** Four upper eave corners and two entrance lanterns, with one distinct character on each. */
export const addChineseHeadquartersLanterns = (add: Add) => {
  const sites = [
    [-.72, 2.48, .79, .50, .28], [.72, 2.48, .79, .50, .28],
    [-.72, 2.48, -.79, .50, .28], [.72, 2.48, -.79, .50, .28],
    [-.96, 1.38, .98, .43, .25], [.96, 1.38, .98, .43, .25]
  ] as const;
  for (const [inscription, [x, top, z, height, width]] of sites.entries()) {
    const suspension = top < 2 ? top - .28 : top;
    const pivot: Point3 = [x, top, z], yaw = z < 0 ? Math.PI : 0;
    add({ position: [x, suspension - height / 2, z!], shape: "chinese-lantern",
      size: [width, height, width], rotation: [0, yaw, 0], decorVariant: inscription,
      stage: 3, surface: "paint", swayPivot: pivot });
    if (suspension < top) add({ position: [x, (top + suspension) / 2, z],
      shape: "box", size: [.008, top - suspension + .012, .008], stage: 3,
      surface: "wood", swayPivot: pivot });
    // A short timber hanger enters the eave, so the cord is never suspended from empty air.
    add({ position: [x, top + .015, z - Math.sign(z) * .055], shape: "bevel-box", size: [.025, .03, .16],
      stage: 2, surface: "wood" });
  }
};
