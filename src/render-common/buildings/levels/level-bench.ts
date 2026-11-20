import type { Point3 } from "../building-recipe";
import { type LevelKit, type LevelPart, wallFace } from "./level-kit";
import { oriented } from "./level-wall-pieces";
import { findYardSpots, type YardSpot } from "./level-yard-props";

/**
 * Level 2 house bench against a camera-side wall, preferably the door façade: with the plinth and
 * the paved forecourt it gives the repaired house a lived-in silhouette at the ground line. Viking:
 * a split-plank seat on two log stumps with a carved back board; Nubian: a plastered mud-brick
 * mastaba with a fired-brick top.
 */
const BENCH = { depth: .16, height: .2, width: .56 } as const;
/** Viking back board: its top over the ground and thickness. */
const BACK = { thickness: .03, top: .4 } as const;
const MASTABA_TOP: Point3 = [.68, .4, .28];
const MASTABA_WALL: Point3 = [.84, .7, .52];

/** The camera-side spot for the bench: one on the door façade first, else the best facing wall. */
const findBenchSpot = (kit: LevelKit) => {
  const tall = kit.site.nation === "viking" ? BACK.top : BENCH.height;
  const spots = findYardSpots(kit, [BENCH.width + .04, tall + .02, BENCH.depth + .02]);
  const front = spots.find(spot => spot.wall.along === 0 && Math.abs(spot.at[2] - kit.site.door.z) < .5 &&
    spot.at[2] > kit.site.centre[2]);
  return front ?? spots[0] ?? null;
};

const vikingBench = (kit: LevelKit, { alongX, at: [x, , z], wall }: YardSpot): LevelPart[] => {
  const along = alongX ? 0 : 2, timber = kit.detailed ? "bevel-box" : "box";
  const at = (shift: number, y: number, out = 0): Point3 => alongX ? [x + shift, y, z + out] : [x + out, y, z + shift];
  const inward = -wallFace(kit.site, wall).sign;
  const parts: LevelPart[] = [-1, 1].map(side => ({
    position: at(side * (BENCH.width / 2 - .08), (BENCH.height - .03) / 2), radialSegments: kit.detailed ? 7 : 5,
    shape: "cylinder", size: [.1, BENCH.height - .03, .1], surface: "bark" }));
  parts.push({ position: at(0, BENCH.height - .015), shape: timber,
    size: oriented(along, BENCH.width, .03, BENCH.depth), surface: "wood" });
  parts.push({ position: at(0, (BENCH.height + BACK.top) / 2, inward * (BENCH.depth / 2 - BACK.thickness / 2)),
    shape: timber, size: oriented(along, BENCH.width - .06, BACK.top - BENCH.height, BACK.thickness),
    surface: "wood" });
  return parts;
};

const mastaba = (kit: LevelKit, { alongX, at: [x, , z] }: YardSpot): LevelPart[] => {
  const along = alongX ? 0 : 2, body = BENCH.height - .03;
  return [
    { position: [x, body / 2, z], shape: kit.detailed ? "bevel-box" : "box",
      size: oriented(along, BENCH.width, body, BENCH.depth), surface: "plaster", tint: MASTABA_WALL },
    { position: [x, body + .015, z], shape: "box", size: oriented(along, BENCH.width + .02, .03, BENCH.depth + .02),
      surface: "stone", tint: MASTABA_TOP }
  ];
};

/** Level 2 bench beside the door (Viking log bench, Nubian mastaba); false when no wall has room. */
export const addHouseBench = (kit: LevelKit) => {
  const spot = findBenchSpot(kit);
  if (!spot) return false;
  const parts = kit.site.nation === "nubian" ? mastaba(kit, spot) : vikingBench(kit, spot);
  for (const part of parts) kit.add({ stage: 2, ...part });
  return true;
};
