import type { BuildingPart, Point3 } from "./building-recipe";
import type { Add } from "./nation-kit-parts";

type Tint = NonNullable<BuildingPart["tint"]>;
const LIMESTONE: Tint = [.86, .74, .56];
const IVORY: Tint = [.96, .86, .66];
const CEDAR: Tint = [.28, .19, .10];

/** Two centred circular arcs meet at a real pointed apex; no triangular false arch. */
export const persianArchHeight = (x: number, width: number, rise: number) => {
  const half = width / 2;
  const centre = (rise * rise - half * half) / (2 * half);
  const radius = centre + half;
  return Math.sqrt(Math.max(0, radius * radius - (Math.abs(x) + centre) ** 2));
};

const beam = (add: Add, a: Point3, b: Point3, thickness: number, depth: number,
  surface: BuildingPart["surface"], tint: Tint) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  add({ position: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2]],
    rotation: [0, 0, Math.atan2(dy, dx)], shape: "bevel-box", stage: 3, compactGeometry: surface === "wood",
    size: [Math.hypot(dx, dy) + .004, thickness, depth], surface, tint });
};

/** Fitted stone voussoirs and deep jambs keep the opening genuinely open. */
export const addPersianPointedArch = (add: Add, x: number, base: number, z: number,
  width: number, spring: number, rise: number, thickness: number, depth: number, detailed: boolean) => {
  const half = width / 2, slices = detailed ? 12 : 6;
  for (const side of [-1, 1]) {
    const courses = detailed ? Math.max(2, Math.ceil(spring / .24)) : 2;
    for (let row = 0; row < courses; row++) add({
      position: [x + side * (half + thickness / 2), base + spring * (row + .5) / courses, z],
      shape: "bevel-box", size: [thickness, spring / courses - .003, depth], stage: 2,
      surface: "plaster", tint: row % 3 === 1 ? IVORY : LIMESTONE });
    for (let index = 0; index < slices; index++) {
      const localA = half * index / slices, localB = half * (index + 1) / slices;
      const a: Point3 = [x + side * localA, base + spring + persianArchHeight(localA, width, rise), z];
      const b: Point3 = [x + side * localB, base + spring + persianArchHeight(localB, width, rise), z];
      beam(add, a, b, thickness, depth, "plaster", index % 4 === 2 ? IVORY : LIMESTONE);
    }
  }
};

/** A thick pishtaq facade, with a genuine curved opening and masonry filling the shoulders above it. */
export const addPersianPishtaq = (add: Add, x: number, base: number, z: number,
  width: number, spring: number, rise: number, thickness: number, depth: number, detailed: boolean) => {
  const outerWidth = width + thickness * 2, height = rise + thickness * 1.35;
  add({ position: [x, base + spring + height / 2, z - depth * .13], shape: "persian-arch-spandrel",
    size: [outerWidth, height, depth * .70], pointedArchOpening: [width / outerWidth, rise / height],
    stage: 3, surface: "plaster", tint: LIMESTONE });
  addPersianPointedArch(add, x, base, z, width, spring, rise, thickness, depth, detailed);
  add({ position: [x, base + spring + height - .025, z + depth * .24], shape: "bevel-box",
    size: [outerWidth + .10, .065, depth * .65], stage: 3, surface: "plaster", tint: IVORY });
};

/** Diamond jali clipped to the pointed outline; the holes are real gaps, not black painted squares. */
export const addPersianDiamondLattice = (add: Add, x: number, base: number, z: number, width: number,
  spring: number, rise: number, detailed: boolean, pitch = detailed ? .11 : .19) => {
  const half = width / 2 - .022;
  const top = spring + rise, steps = detailed ? 48 : 24;
  for (const slope of [-1, 1]) for (let intercept = -.9 * width; intercept <= top + width; intercept += pitch) {
    let first: Point3 | undefined, last: Point3 | undefined;
    for (let step = 0; step <= steps; step++) {
      const px = -half + step / steps * half * 2, py = slope * px + intercept;
      if (py < .025 || py > spring + persianArchHeight(px, width, rise) - .018) continue;
      const point: Point3 = [x + px, base + py, z];
      first ??= point; last = point;
    }
    if (first && last && Math.hypot(last[0] - first[0], last[1] - first[1]) > .025)
      beam(add, first, last, detailed ? .012 : .018, .025, "wood", CEDAR);
  }
};

/** A shadowed niche with a deep reveal, projecting sill and pierced timber lattice. */
export const addPersianLatticeNiche = (add: Add, x: number, base: number, z: number,
  width: number, spring: number, rise: number, detailed: boolean, open = false) => {
  const thickness = Math.min(.075, width * .12), depth = open ? .34 : .10;
  // The backing is recessed behind the real lattice and jambs, with warm shaded plaster instead of black.
  const rows = detailed ? 12 : 6;
  for (let index = 0; !open && index < rows; index++) {
    const a = -width / 2 + width * index / rows, b = a + width / rows;
    const height = spring + Math.min(persianArchHeight(a, width, rise), persianArchHeight(b, width, rise));
    add({ position: [x + (a + b) / 2, base + height / 2, z - depth * .46],
      shape: "box", size: [width / rows + .001, height, .016], stage: 2,
      surface: "paint", tint: [.34, .275, .185] });
  }
  addPersianPointedArch(add, x, base, z - (depth - .10) / 2, width, spring, rise, thickness, depth, detailed);
  addPersianDiamondLattice(add, x, base, z + .018, width, spring, rise, detailed);
  add({ position: [x, base - .025, z + .012 - (depth - .10) / 2], shape: "bevel-box",
    size: [width + thickness * 2 + .08, .055, depth + .08], stage: 2, surface: "plaster", tint: IVORY });
};
