import type { RomanDesignContext } from "./roman-design-kit";

/**
 * Commander's Lodge authoring plan (type 62). The canonical building anchors keep the shared
 * 4 x 4 plot, door lane and work/worker contacts of the former shell; the architecture is a
 * dedicated lodge: a stone hall with a timber entrance porch and a commander's plaque, not the
 * retired Stable shell. The national kits rebuild these walls, door and roof in each nation's
 * construction; the per-nation stable bay, mustering yard and standard are added afterwards
 * (nation-commander-lodge-designs.ts).
 */
export const COMMANDER_LODGE = {
  centreZ: .155,
  depth: .84,
  doorWidth: .46,
  entryX: .05,
  height: .98,
  width: 1.28
} as const;

const BASE = .18;
const FRONT = COMMANDER_LODGE.centreZ + COMMANDER_LODGE.depth / 2;
const BACK = COMMANDER_LODGE.centreZ - COMMANDER_LODGE.depth / 2;
const HALF_X = COMMANDER_LODGE.width / 2;
/** Flat door leaf head height (the shared doorDimensions.height is 0.77 in the finished model). */
const DOOR_TOP = .95;
const WALL_TOP = BASE + COMMANDER_LODGE.height;
type LodgeDetail = Pick<RomanDesignContext, "detailed" | "part">;

/** Stone shell with a real entrance opening, floor, wall plate and the shared gabled roof. */
const addLodgeBody = ({ detailed, part, roof }: RomanDesignContext) => {
  const { width } = COMMANDER_LODGE;
  part("stone", [0, BASE + COMMANDER_LODGE.height / 2, BACK + .055], [width, COMMANDER_LODGE.height, .11], 1);
  for (const side of [-1, 1])
    part("stone", [side * (HALF_X - .055), BASE + COMMANDER_LODGE.height / 2, COMMANDER_LODGE.centreZ],
      [.11, COMMANDER_LODGE.height, COMMANDER_LODGE.depth], 1);
  const opening = COMMANDER_LODGE.doorWidth / 2;
  for (const side of [-1, 1]) {
    const edge = COMMANDER_LODGE.entryX + side * opening;
    const outer = side * HALF_X;
    part("stone", [(edge + outer) / 2, BASE + COMMANDER_LODGE.height / 2, FRONT],
      [Math.abs(outer - edge), COMMANDER_LODGE.height, .11], 1);
  }
  part("stone", [COMMANDER_LODGE.entryX, (WALL_TOP + BASE + DOOR_TOP) / 2, FRONT],
    [COMMANDER_LODGE.doorWidth, WALL_TOP - BASE - DOOR_TOP, .11], 1);
  // Stone jambs and a shallow relieving lintel over the shared door leaf.
  for (const side of [-1, 1])
    part("stone", [COMMANDER_LODGE.entryX + side * .27, BASE + .38, FRONT + .04], [.075, .76, .12], 2);
  part("stone", [COMMANDER_LODGE.entryX, BASE + .82, FRONT + .04], [.62, .1, .12], 2);
  part("dark", [0, BASE + .012, COMMANDER_LODGE.centreZ], [width - .18, .024, COMMANDER_LODGE.depth - .18], 0);
  part("stone", [0, WALL_TOP + .035, COMMANDER_LODGE.centreZ], [width + .04, .07, COMMANDER_LODGE.depth + .04], 2);
  roof(0, WALL_TOP + .1, COMMANDER_LODGE.centreZ, width + .22, COMMANDER_LODGE.depth + .22);
  addSideWindows({ detailed, part });
};

/** Two windows on each long wall: the commander's quarters, not a windowless hall. */
const addSideWindows = ({ detailed, part }: LodgeDetail) => {
  for (const side of [-1, 1])
    for (const z of detailed ? [-.04, .3] : [.13]) {
      const x = side * (HALF_X + .002);
      part("dark", [x, BASE + .66, z], [.018, .25, .2], 2);
      if (!detailed) continue;
      part("wood", [x + side * .012, BASE + .66, z], [.02, .29, .025], 3);
      part("wood", [x + side * .012, BASE + .54, z], [.02, .025, .24], 3);
      part("wood", [x + side * .012, BASE + .78, z], [.02, .025, .24], 3);
    }
};

/** Post-and-beam entrance porch: two posts clear of the door lane and a shallow timber canopy. */
const addEntrancePorch = ({ detailed, part }: LodgeDetail) => {
  const z = FRONT + .27;
  for (const x of [-.53, .61]) {
    part("stone", [x, BASE + .045, z], [.22, .09, .22], 2);
    part("stone", [x, BASE + .45, z], [.13, .81, .13], 2, "cylinder");
    part("stone", [x, BASE + .88, z], [.24, .09, .24], 2);
    if (!detailed) continue;
    part("wood", [x, BASE + .77, FRONT + .04], [.05, .05, .44], 3, "box", [0, 0, 0]);
  }
  part("wood", [.04, BASE + .93, z], [1.34, .09, .13], 2);
  for (const side of [-1, 1])
    part("wood", [side * .38, BASE + .86, FRONT + .1], [.05, .18, .05], 3, "bevel-box", [side * .6, 0, 0]);
  // Plank canopy, pitched from the facade out over the porch.
  part("planks", [.04, BASE + 1.01, z - .02], [1.44, .045, .52], 3, "box", [-.1, 0, 0]);
  if (detailed) {
    for (const x of [-.53, .61]) part("wood", [x, BASE + .985, z], [.18, .035, .18], 3);
    part("wood", [.04, BASE + .985, z], [1.3, .025, .05], 3);
  }
};

/** A commander's plaque above the door: the lodge reads as a military quarters, not a cottage. */
const addLodgePlaque = ({ detailed, part }: LodgeDetail) => {
  const y = BASE + .87, z = FRONT + .07;
  part("wood", [COMMANDER_LODGE.entryX, y, z], [.46, .16, .04], 3, "bevel-box");
  part("gold", [COMMANDER_LODGE.entryX, y + .012, z + .025], [.3, .09, .012], 3, "bevel-box");
  if (!detailed) return;
  for (const x of [-.17, -.09, 0, .09, .17])
    part("gold", [COMMANDER_LODGE.entryX + x, y + .012, z + .034], [.035, .09, .012], 3, "box",
      [0, 0, Math.PI / 4]);
};

/** Ground-floor furniture inside the open door: a campaign table, stool and a rolled map. */
const addLodgeInterior = ({ detailed, part }: LodgeDetail) => {
  part("wood", [-.3, BASE + .18, -.02], [.48, .05, .34], 3);
  for (const [x, z] of [[-.51, -.16], [-.51, .12], [-.09, -.16], [-.09, .12]] as const)
    part("wood", [x, BASE + .09, z], [.05, .18, .05], 3);
  if (!detailed) return;
  part("paint", [-.3, BASE + .215, -.02], [.31, .012, .2], 3, "box", undefined, [.78, .7, .54]);
  part("wood", [-.3, BASE + .24, .02], [.075, .012, .24], 3, "cylinder", [0, 0, Math.PI / 2],
    [.62, .43, .24]);
  part("wood", [.29, BASE + .11, .17], [.18, .22, .18], 3, "cylinder");
};

/**
 * Roman Commander's Lodge: the authoring plan every national kit rebuilds, with the canonical
 * anchors untouched. A dedicated lodge hall, entrance porch, plaque and campaign interior.
 */
export const addRomanCommanderLodge = (context: RomanDesignContext) => {
  addLodgeBody(context);
  addEntrancePorch(context);
  addLodgePlaque(context);
  addLodgeInterior(context);
};

/** Canonical authored points used by the national post-design layer. */
export const COMMANDER_LODGE_POINTS = {
  back: BACK,
  front: FRONT,
  wallTop: WALL_TOP - BASE
} as const;
