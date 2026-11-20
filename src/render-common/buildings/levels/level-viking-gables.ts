import type { BuildingPart, Point3 } from "../building-recipe";
import type { LevelKit } from "./level-kit";

/**
 * Level 5 Viking gable dress: painted barge strips along both rakes of each main gable and a carved
 * gable boss under the dragon heads.
 */
const RED_OCHRE: Point3 = [.56, .17, .1];
const YELLOW_OCHRE: Point3 = [.82, .62, .24];
const STRIP = { inset: .045, thickness: .016, width: .07 } as const;

interface Gable { apex: Point3; base: number; halfWidth: number; outward: number; plane: 0 | 2 }

/** The main roof's plank gable infills (the largest pair), with the plane they lie in and their outward side. */
const mainGables = (kit: LevelKit): Gable[] => {
  const infills = kit.site.parts.filter(part => part.shape === "gable" && part.surface === "planks");
  const largest = Math.max(0, ...infills.map(part => part.size[0] * part.size[1]));
  return infills.filter(part => part.size[0] * part.size[1] > largest * .9).map(part => gableOf(kit, part));
};

const gableOf = (kit: LevelKit, part: BuildingPart): Gable => {
  // A gable turned a quarter round faces along x: it lies in the z-y plane.
  const normal: 0 | 2 = part.rotation && Math.abs(part.rotation[1]) > .1 ? 0 : 2;
  const outward = Math.sign(part.position[normal]! - kit.site.centre[normal]!) || 1;
  const apex: Point3 = [...part.position];
  apex[normal] += outward * (part.size[2] / 2 + STRIP.thickness / 2 + .002);
  apex[1] += part.size[1] / 2;
  return { apex, base: part.position[1] - part.size[1] / 2, halfWidth: part.size[0] / 2,
    outward, plane: normal === 2 ? 0 : 2 };
};

/** A painted strip on the gable face, parallel to one rake, `inset` below it. */
const rakeStrip = (kit: LevelKit, gable: Gable, side: number, inset: number, width: number, tint: Point3) => {
  const { apex, base, halfWidth, plane } = gable, rise = apex[1] - base;
  const length = Math.hypot(halfWidth, rise) - inset * 1.6, slope = Math.atan2(rise, halfWidth);
  const centre: Point3 = [...apex];
  centre[plane] += side * halfWidth / 2;
  centre[1] = base + rise / 2 - inset / Math.cos(slope);
  const size: Point3 = plane === 0 ? [length, width, STRIP.thickness] : [STRIP.thickness, width, length];
  const angle = -side * slope;
  const rotation: Point3 = plane === 0 ? [0, 0, angle] : [-angle, 0, 0];
  kit.add({ position: centre, rotation, shape: "box", size, stage: 4, surface: "paint", tint });
};

/** A carved round boss under the crossing boards (High adds its gilded centre). */
const gableBoss = (kit: LevelKit, { apex, base, outward, plane }: Gable) => {
  const centre: Point3 = [...apex], normal = plane === 0 ? 2 : 0, diameter = Math.min(.16, (apex[1] - base) * .3);
  centre[1] = apex[1] - diameter * 1.4;
  const rotation: Point3 = normal === 2 ? [Math.PI / 2, 0, 0] : [0, 0, Math.PI / 2];
  kit.add({ position: centre, radialSegments: kit.detailed ? 12 : 6, rotation, shape: "cylinder",
    size: [diameter, .02, diameter], stage: 4, surface: "paint", tint: RED_OCHRE });
  if (!kit.detailed) return;
  centre[normal] += outward * .012;
  kit.add({ position: centre, radialSegments: 8, rotation, shape: "cylinder",
    size: [diameter * .45, .012, diameter * .45], stage: 4, surface: "gold" });
};

/** Painted barge strips (High: a yellow bead inside the red) and the carved boss on each main gable. */
export const addPaintedGables = (kit: LevelKit) => {
  for (const gable of mainGables(kit)) {
    for (const side of [-1, 1]) {
      rakeStrip(kit, gable, side, STRIP.inset, STRIP.width, RED_OCHRE);
      if (kit.detailed) rakeStrip(kit, gable, side, STRIP.inset + STRIP.width * .85, STRIP.width * .35,
        YELLOW_OCHRE);
    }
    gableBoss(kit, gable);
  }
};
