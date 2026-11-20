import type { WorkerNation } from "../../workers/worker-unit";
import type { Point3 } from "../building-recipe";
import {
  alongWallBox, doorFront, groundWalls, type LevelKit, spansClearOfDoor
} from "./level-kit";

/**
 * Level 2 paved forecourt: flagstones laid flush on the ground in front of the door (Viking grey
 * slate, Nubian fired brick), so the repaired house reads from afar by its lighter forecourt. Only
 * 2.5 cm high: the door lane, approaches and work points stay walkable and unchanged.
 */
const APRON = { depth: .5, gap: .016, height: .025, sideReach: .3, slab: .16 } as const;

const PAVING: Readonly<Partial<Record<WorkerNation, readonly Point3[]>>> = {
  nubian: [[.68, .4, .28], [.6, .34, .24], [.72, .46, .32]],
  viking: [[.6, .6, .58], [.52, .53, .52], [.66, .65, .6]]
};

interface Apron { minX: number; maxX: number; minZ: number; maxZ: number }

/** The forecourt's plan rectangle in front of the door's façade, inside the plot. */
const apronOf = (kit: LevelKit): Apron | null => {
  const front = doorFront(kit.site);
  if (!front) return null;
  const { door, limit } = kit.site, maxZ = Math.min(front.face + APRON.depth, limit.extentZ - .02);
  const minX = Math.max(door.left - APRON.sideReach, -limit.extentX), maxX = Math.min(door.right + APRON.sideReach,
    limit.extentX);
  return maxZ - front.face < APRON.slab ? null : { maxX, maxZ, minX, minZ: front.face };
};

/** One flagstone, its top flush at the apron height. */
const slab = (kit: LevelKit, x: number, z: number, size: [number, number], tint: Point3) =>
  kit.add({ position: [x, APRON.height / 2, z], shape: kit.detailed ? "bevel-box" : "box",
    size: [size[0], APRON.height, size[1]], stage: 1, surface: "stone", tint });

/** High: a staggered grid of flagstones in three tones; Minimal: one slab. */
export const addPavedApron = (kit: LevelKit) => {
  const tints = PAVING[kit.site.nation], apron = apronOf(kit);
  if (!tints || !apron) return;
  const { maxX, maxZ, minX, minZ } = apron;
  if (!kit.detailed) {
    slab(kit, (minX + maxX) / 2, (minZ + maxZ) / 2, [maxX - minX, maxZ - minZ], tints[0]!);
    return;
  }
  const rows = Math.round((maxZ - minZ) / APRON.slab), depth = (maxZ - minZ) / rows;
  for (let row = 0; row < rows; row++) {
    const shift = row % 2 ? APRON.slab / 2 : 0, z = minZ + depth * (row + .5);
    for (let x = minX - shift; x < maxX; x += APRON.slab) {
      const from = Math.max(x, minX), to = Math.min(x + APRON.slab, maxX);
      if (to - from < APRON.slab / 3) continue;
      const pick = (row + Math.round(x / APRON.slab)) % tints.length;
      const tint = tints[(pick + tints.length) % tints.length]!;
      slab(kit, (from + to) / 2, z, [to - from - APRON.gap, depth - APRON.gap], tint);
    }
  }
};

/**
 * Drip paving: a narrow strip of the same flagstones round the walls' foot, outside the plinth, so
 * the repaired house reads at level 2 from every side (the forecourt only shows at the door). One
 * slab per wall span, open at the doorway; neighbouring walls differ by 3 mm where their corners overlap.
 */
const DRIP = { out: .2, width: .13 } as const;

export const addDripPaving = (kit: LevelKit) => {
  const tints = PAVING[kit.site.nation];
  if (!tints) return;
  groundWalls(kit.site).forEach((wall, index) => {
    for (const span of spansClearOfDoor(kit.site, wall, .09)) {
      const box = alongWallBox(kit.site, wall, span, { bottom: 0, depth: DRIP.width, extend: DRIP.out,
        height: APRON.height - .004 - index % 2 * .003, out: DRIP.out });
      kit.add({ ...box, shape: "box", stage: 1, surface: "stone", tint: tints[(index + 1) % tints.length]! });
    }
  });
};
