import type { Point3 } from "./building-recipe";
import type { KitContext } from "./nation-kit-parts";

/** Rear and side rails finish before the stock bays; the entire entrance side stays open. */
export const addPersianMillYard = ({ add, detailed }: KitContext) => {
  const timber = { compactGeometry: true, stage: 3, surface: "wood" } as const;
  const post = (x: number, z: number) => add({ ...timber, position: [x, .14, z],
    shape: "bevel-box", size: [.055, .28, .055] });
  const rail = (position: Point3, size: Point3) => add({ ...timber, position, shape: "box", size });
  for (const x of [-1.18, 1.18]) {
    for (const z of [-.64, -.24, .16]) post(x, z);
    for (const y of detailed ? [.10, .22] : [.18])
      rail([x, y, -.24], [.035, .045, .8]);
  }
  for (const x of [-.59, 0, .59]) post(x, -.64);
  for (const y of detailed ? [.10, .22] : [.18])
    rail([0, y, -.64], [2.36, .045, .035]);

  // Empty decorative vessels are separate from all grain/flour inventory and contacts.
  for (const x of [-.73, .73]) {
    add({ position: [x, .17, -.25], shape: "clay-jar", size: [.22, .34, .22],
      radialSegments: detailed ? 16 : 6, stage: 4, surface: "paint", tint: [.61, .35, .18] });
    add({ position: [x, .31, -.25], shape: "ring", size: [.09, .025, .09],
      radialSegments: detailed ? 12 : 6, stage: 4, surface: "paint", tint: [.89, .73, .47] });
  }
};
