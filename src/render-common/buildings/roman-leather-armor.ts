import { addArmourCuirass } from "../wares/ware-armour-recipe";
import type { Point3 } from "./building-recipe";
import { withBuildingStock } from "./building-stock-parts";
import { romanBench, type RomanDesignContext } from "./roman-design-kit";
import type { AddPart } from "./roman-resource-workshops";

const BENCH_ARMOUR_SCALE = 0.38;
/** Cuirass centre height so its skirt rests on the bench top. */
const BENCH_ARMOUR_Y = 0.757;

const scaleBenchArmour = (part: AddPart, origin: Point3): AddPart =>
  (surface, position, size, stage, shape, rotation, tint) => part(surface,
    position.map((value, axis) => origin[axis]! + value * BENCH_ARMOUR_SCALE) as Point3,
    size.map(value => value * BENCH_ARMOUR_SCALE) as Point3, stage, shape, rotation, tint);

/** Finished leather cuirasses and a stitching bench, distinct from hide-stretching workshops. */
export const addRomanLeatherArmorWorkshop = ({ detailed, part }: RomanDesignContext) => {
  const leather: [number, number, number] = [0.3, 0.16, 0.07];
  romanBench(part, -1.21, 0.27, 0.5, 0.71);
  // Six upright cuirasses (the shared armour ware, scaled) occupy two rows on the output bench.
  for (let i = 0; i < 6; i++) {
    const x = -1.355 + (i % 3) * 0.145;
    const z = 0.12 + Math.floor(i / 3) * 0.3;
    addArmourCuirass(scaleBenchArmour(withBuildingStock(part, "armor", i), [x, BENCH_ARMOUR_Y, z]), detailed);
  }
  // Work area and leather input remain by the right wall, away from the front approach.
  romanBench(part, 0.95, 0.12, 0.56, 0.66);
  withBuildingStock(part, "leather", 0, "input")("paint", [0.95, 0.7, 0.04], [0.34, 0.025, 0.34], 3,
    "sphere", undefined, [0.45, 0.26, 0.12]);
  withBuildingStock(part, "leather", 1, "input")("paint", [1.12, 0.73, -0.1], [0.08, 0.26, 0.08], 3,
    "cylinder", [Math.PI / 2, 0, 0], leather);
  part("wood", [0.85, 0.72, 0.3], [0.028, 0.028, 0.12], 3);
  part("steel", [0.85, 0.72, 0.205], [0.012, 0.012, 0.07], 3);
  if (!detailed) return;
  // Awl, coiled thread and small edge stitches make the process recognizable.
  part("rope", [1.04, 0.719, 0.22], [0.08, 0.026, 0.08], 3, "ring");
  for (let i = 0; i < 5; i++)
    part("rope", [0.83 + i * 0.06, 0.715, 0.17], [0.02, 0.008, 0.006], 3);
};
