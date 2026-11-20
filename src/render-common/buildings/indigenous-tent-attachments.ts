import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import type { IndigenousRoofProfile } from "./indigenous-roof-profile";
import { type Add, runBetween } from "./nation-kit-parts";

/** Canonical twelve membrane attachment points, normalized to the tent's full width/depth. */
export const indigenousSkirtAnchors = (profile: IndigenousRoofProfile,
  frameRadius = .065, detailed = true): ReadonlyArray<readonly [number, number]> => {
  if (profile === "framed") {
    const anchors: ReadonlyArray<readonly [number, number]> = [
      [-.4, .5], [0, .5], [.4, .5], [.5, .35], [.5, 0], [.5, -.35],
      [.4, -.5], [0, -.5], [-.4, -.5], [-.5, -.35], [-.5, 0], [-.5, .35]
    ];
    const radius = Math.max(.025, Math.min(.45, frameRadius)), inset = .5 - radius;
    return anchors.map(([x, z]) => {
      let px = Math.abs(x), pz = Math.abs(z);
      let insetScale = 1;
      if (px > inset && pz > inset) {
        // Follow the same quadratic corner as the actual sleeve, rather than tying to empty air.
        if (px < pz) pz = .5 - radius * (1 - Math.sqrt((.5 - px) / radius)) ** 2;
        else px = .5 - radius * (1 - Math.sqrt((.5 - pz) / radius)) ** 2;
        insetScale = .9975;
      }
      // Minimal approximates curved corners with chords: sink the tie into that leaner hem.
      if (!detailed && Math.min(px, pz) > .3) insetScale *= .98;
      return [Math.sign(x) * px * insetScale, Math.sign(z) * pz * insetScale] as const;
    });
  }
  if (profile !== "earth") return Array.from({ length: 12 }, (_, index) => {
    const angle = Math.PI * 2 * index / 12;
    return [Math.sin(angle) * .5, Math.cos(angle) * .5] as const;
  });
  const front = Array.from({ length: 5 }, (_, index) => {
    const angle = -Math.PI / 2 + Math.PI * index / 4;
    return [Math.sin(angle) * .5, .2 + Math.cos(angle) * .3] as const;
  });
  const back = Array.from({ length: 5 }, (_, index) => {
    const angle = Math.PI / 2 + Math.PI * index / 4;
    return [Math.sin(angle) * .5, -.2 + Math.cos(angle) * .3] as const;
  });
  return [...front, [.5, 0], ...back, [-.5, 0]];
};

/** Short grounded skirt ties stay within the reserved envelope and away from every service lane. */
export const addIndigenousSkirtPegs = (add: Add, centre: Point3, size: Point3, profile: IndigenousRoofProfile,
  original: BuildingRecipe, obstacles: readonly BuildingPart[], detailed: boolean, frameRadius = .065) => {
  const door = original.door, doorX = door[0] + (original.doorDimensions?.width ?? .46) / 2;
  indigenousSkirtAnchors(profile, frameRadius, detailed).forEach(([u, v], index) => {
    if (!detailed && index % 2) return;
    const x = centre[0] + u * size[0], z = centre[2] + v * size[2];
    const outward = Math.hypot(u, v), dx = u / outward * .025, dz = v / outward * .025;
    const peg: Point3 = [x + dx, .045, z + dz];
    if (Math.abs(peg[0] - doorX) < .5 && peg[2] > door[2] - .25) return;
    if ([original.workPoint, original.workerExit].some(point =>
      Math.hypot(peg[0] - point[0], peg[2] - point[2]) < .35)) return;
    if (obstacles.some(part => {
      const { max, min } = getRomanPartBounds(part);
      return peg[0] > min[0] - .05 && peg[0] < max[0] + .05 && peg[2] > min[2] - .05 && peg[2] < max[2] + .05;
    })) return;
    add({ position: [peg[0], .025, peg[2]], radialSegments: detailed ? 6 : 4, shape: "cylinder",
      size: [.025, .14, .025], stage: 1, surface: "wood" });
    runBetween(add, [x, .016, z], [peg[0], .075, peg[2]], [.007, .007],
      { stage: 3, surface: "rope" });
  });
};
