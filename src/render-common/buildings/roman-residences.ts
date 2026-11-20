import { DMath } from "../../shared/math/deterministic-math";
import { romanBarrel, romanBench, romanCanopy, type RomanDesignContext, romanRoom } from "./roman-design-kit";

/**
 * Roman residences (POP-02, "population first"): plain stone houses under terracotta roofs, told
 * apart by size — a cottage, a house with a side porch and a two-storey town house. Every door is the
 * shared Roman door (romanRoom's south entrance); nation kits restyle walls and roofs as elsewhere.
 * Nation-specific art and the upgrade look follow in FUTURE-01.
 */
export const SMALL_RESIDENCE = { width: 2, depth: 0.9, height: 1.05, entryX: -0.35 } as const;
export const MEDIUM_RESIDENCE = { width: 2.4, depth: 0.9, height: 1.15, entryX: -0.5 } as const;
export const BIG_RESIDENCE = { width: 3.6, depth: 1.1, height: 1.15, entryX: 0 } as const;

const GROUND = 0.18;
/** Window sill height above the ground: settler-head height, below the wall top of every residence. */
const SILL = 0.5;
/** romanRoom walls are 0.11 thick and centred on the room edge: their outer face is this far out. */
const WALL_FACE = 0.055;

/** A shuttered window set into a wall facing +Z (front) or ±X (side); High adds sill and shutters. */
const addWindow = (
  { detailed, part }: RomanDesignContext, x: number, z: number, facing: "front" | "left" | "right", base = GROUND
) => {
  const y = base + SILL + 0.15;
  if (facing === "front") {
    const face = z + WALL_FACE;
    part("dark", [x, y, face + 0.006], [0.26, 0.3, 0.02], 3);
    if (!detailed) return;
    part("stone", [x, y - 0.17, face + 0.03], [0.34, 0.04, 0.07], 3);
    for (const side of [-1, 1]) part("wood", [x + side * 0.2, y, face + 0.012], [0.13, 0.3, 0.025], 3);
    return;
  }
  const out = facing === "right" ? 1 : -1;
  part("dark", [x + out * 0.006, y, z], [0.02, 0.3, 0.26], 3);
  if (detailed) part("stone", [x + out * 0.035, y - 0.17, z], [0.07, 0.04, 0.34], 3);
};

/** Window box hung under a front window: a planter resting on its sill brackets, with plants. */
const addFlowerBox = ({ detailed, part }: RomanDesignContext, x: number, z: number, base = GROUND) => {
  if (!detailed) return;
  const y = base + SILL - 0.08, face = z + WALL_FACE;
  part("wood", [x, y, face + 0.05], [0.32, 0.08, 0.1], 3);
  for (const side of [-1, 1]) part("wood", [x + side * 0.12, y - 0.06, face + 0.03], [0.03, 0.06, 0.06], 3);
  for (const dx of [-0.1, 0, 0.1]) part("leaf", [x + dx, y + 0.06, face + 0.05], [0.1, 0.08, 0.08], 3, "sphere");
};

/**
 * A chimney rising from the wall top (`wallTop`) through the roof slope to above the ridge line
 * at its position; `ridge` is the roof height there.
 */
const addChimney = ({ detailed, part }: RomanDesignContext, x: number, z: number, wallTop: number, top: number) => {
  part("stone", [x, (wallTop + top) / 2, z], [0.18, top - wallTop, 0.18], 2);
  part("stone", [x, top + 0.025, z], [0.24, 0.05, 0.24], 3);
  if (detailed) part("dark", [x, top + 0.052, z], [0.1, 0.006, 0.1], 3, "window-shadow");
};

/** Roof surface height of a romanRoom roof at horizontal distance `offset` from its ridge. */
const roofHeightAt = (wallTop: number, roofWidth: number, offset: number) =>
  wallTop + 0.1 + DMath.tan(0.54) * (roofWidth / 2 - Math.abs(offset));

/** Cottage: one room, a front window with a flower box, a side window and a chimney. */
export const addRomanSmallResidence = (context: RomanDesignContext) => {
  const { entryX, height, width } = SMALL_RESIDENCE;
  const roomDepth = 1.5, roomZ = SMALL_RESIDENCE.depth / 2 - roomDepth / 2;
  romanRoom(context, 0, roomZ, width, roomDepth, height, entryX);
  const front = SMALL_RESIDENCE.depth / 2, wallTop = GROUND + height;
  addWindow(context, 0.45, front, "front");
  addFlowerBox(context, 0.45, front);
  addWindow(context, width / 2, roomZ, "right");
  addChimney(context, 0.55, roomZ - 0.4, wallTop, roofHeightAt(wallTop, width + 0.22, 0.55) + 0.22);
};

/** House: a larger room with two windows, a side porch on posts with a bench and a barrel. */
export const addRomanMediumResidence = (context: RomanDesignContext) => {
  const { detailed, part } = context;
  const { entryX, height, width } = MEDIUM_RESIDENCE;
  const roomDepth = 1.6, roomX = -0.25, roomZ = MEDIUM_RESIDENCE.depth / 2 - roomDepth / 2;
  romanRoom(context, roomX, roomZ, width, roomDepth, height, entryX);
  const front = MEDIUM_RESIDENCE.depth / 2, wallTop = GROUND + height;
  for (const x of [0.35, -1.05]) addWindow(context, x, front, "front");
  addFlowerBox(context, 0.35, front);
  addWindow(context, roomX - width / 2, roomZ, "left");
  // Porch against the east wall: its posts stand clear of the wall, its roof tucks under the eave.
  const porchX = roomX + width / 2 + 0.27;
  romanCanopy(context, porchX, roomZ, 0.5, 1.3, 0.95);
  romanBench(part, porchX, roomZ - 0.2, 0.3, 0.6, 0.42);
  if (detailed) romanBarrel(part, porchX, roomZ + 0.38, detailed, 0.12);
  addChimney(context, roomX - 0.7, roomZ - 0.4, wallTop, roofHeightAt(wallTop, width + 0.22, 0.7) + 0.22);
};

/**
 * Town house: a wide ground floor and a narrower upper storey standing on its stone ceiling slab,
 * with a railed terrace in front of the upper floor, windows on both storeys and a chimney.
 */
export const addRomanBigResidence = (context: RomanDesignContext) => {
  const { detailed, part } = context;
  const { entryX, height, width } = BIG_RESIDENCE;
  const roomDepth = 2, roomZ = BIG_RESIDENCE.depth / 2 - roomDepth / 2;
  romanRoom(context, 0, roomZ, width, roomDepth, height, entryX, GROUND, false);
  const front = BIG_RESIDENCE.depth / 2, groundTop = GROUND + height;
  for (const x of [-1.1, 1.1]) {
    addWindow(context, x, front, "front");
    addFlowerBox(context, x, front);
  }
  for (const side of [-1, 1]) addWindow(context, (side * width) / 2, roomZ, side < 0 ? "left" : "right");
  // Upper storey on the ground floor's ceiling slab (top at groundTop + 0.07).
  const upperBase = groundTop + 0.07, upperWidth = 2.9, upperDepth = 1.4, upperHeight = 0.75;
  const upperZ = roomZ - roomDepth / 2 + upperDepth / 2 + 0.1, upperFront = upperZ + upperDepth / 2;
  romanRoom(context, 0, upperZ, upperWidth, upperDepth, upperHeight, undefined, upperBase);
  for (const x of [-0.95, 0, 0.95]) addWindow(context, x, upperFront, "front", upperBase);
  // Terrace railing on the slab's front edge: posts and two rails, all resting on the slab.
  const railZ = front - 0.04, railBase = upperBase;
  const posts = detailed ? 11 : 5;
  for (let i = 0; i < posts; i++) {
    const x = -width / 2 + 0.06 + (i * (width - 0.12)) / (posts - 1);
    part("wood", [x, railBase + 0.16, railZ], [0.05, 0.32, 0.05], 2);
  }
  for (const y of detailed ? [0.14, 0.3] : [0.3])
    part("wood", [0, railBase + y, railZ], [width - 0.1, 0.035, 0.04], 2);
  const upperTop = upperBase + upperHeight;
  addChimney(context, 0.95, upperZ - 0.35, upperTop, roofHeightAt(upperTop, upperWidth + 0.22, 0.95) + 0.22);
};
