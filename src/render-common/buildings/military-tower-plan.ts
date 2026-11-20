import type { BuildingRecipe, Point3 } from "./building-recipe";

/**
 * The towers of the guardhouse (2), watchtower (4) and fortress (9): where they stand, their decks
 * and their look-out windows. Roman recipes author them; each nation rebuilds them in its own form
 * on the same plan, so posts, windows, doors and flags keep their gameplay meaning.
 */
export type TowerKind = "corner" | "guard" | "keep" | "watch";

/** A look-out window on the tower face pointing along `axis` with outward `sign`. */
export interface TowerWindow { axis: 0 | 2; sign: 1 | -1; sill: number }

export interface TowerPlan {
  kind: TowerKind;
  x: number;
  z: number;
  /** The Roman footprint: x and z size of the square tower. */
  width: number;
  depth: number;
  /** Ground and the deck top the archers stand on. */
  base: number;
  deck: number;
  windows: TowerWindow[];
}

/** Recipes are authored with the ground at this height and lowered onto it afterwards. */
export const AUTHORED_GROUND = .18;
export const FORTRESS_KEEP = { depth: .85, height: 2.6, width: 1.14, z: -.27 };
/** Roman castrum corner towers are round: `radius` replaces the former .72 square. */
export const FORTRESS_CORNER = { height: 2.22, radius: .38, x: 1.06, z: .78 };
const FORTRESS_CORNER_SILL = 1.5;
const FORTRESS_KEEP_SILL = 1.75;
/** Guardhouse corner tower: clear of the hall's eaves, its open deck rises above the roof line. */
export const GUARD_TOWER = { depth: .72, gap: .19, height: 2.1, width: .48, z: .08 };
/** Medium tower: clearly taller than the small guardhouse, with look-out windows on every side. */
export const WATCHTOWER = { depth: 1.12, galleryDepth: 1.34, galleryWidth: 1.55, height: 2.5, width: 1.3 };
export const WATCHTOWER_SILL = WATCHTOWER.height - .42;
/** Archer posts sit on the deck top, which is this far above the authored tower height. */
const DECK_TOP = .04;

/** A window on every side: both x faces first, then the z faces in the given order. */
const windowsAround = (sill: number, zSigns: readonly [1 | -1, 1 | -1]): TowerWindow[] => [
  { axis: 0, sign: -1, sill }, { axis: 0, sign: 1, sill },
  ...zSigns.map((sign): TowerWindow => ({ axis: 2, sign, sill }))
];

/** Fortress windows in their filling order: corner towers' outer faces (front first), then the keep. */
export const fortressTowerPlans = (): TowerPlan[] => {
  const deck = FORTRESS_CORNER.height + DECK_TOP - AUTHORED_GROUND, size = FORTRESS_CORNER.radius * 2;
  const corners = ([1, -1] as const).flatMap(side => [-1, 1].map((sx): TowerPlan => ({
    base: 0, deck, depth: size, kind: "corner", width: size,
    windows: [{ axis: 2, sign: side, sill: FORTRESS_CORNER_SILL - AUTHORED_GROUND }],
    x: sx * FORTRESS_CORNER.x, z: side * FORTRESS_CORNER.z
  })));
  const sill = FORTRESS_KEEP_SILL - AUTHORED_GROUND;
  const keep: TowerPlan = {
    base: 0, deck: FORTRESS_KEEP.height + DECK_TOP - AUTHORED_GROUND, depth: FORTRESS_KEEP.depth,
    kind: "keep", width: FORTRESS_KEEP.width, x: 0, z: FORTRESS_KEEP.z,
    windows: windowsAround(sill, [1, -1])
  };
  return [...corners, keep];
};

const watchtowerPlan = (posts: readonly Point3[]): TowerPlan => {
  const sill = WATCHTOWER_SILL - AUTHORED_GROUND;
  return { base: 0, deck: posts[0]![1], depth: WATCHTOWER.depth, kind: "watch", width: WATCHTOWER.width,
    windows: windowsAround(sill, [-1, 1]), x: 0, z: 0 };
};

/** The guard tower stands beside the hall (towards +x); the recipe may be centred, so posts locate it. */
const guardPlan = (posts: readonly Point3[]): TowerPlan => ({
  base: 0, deck: posts[0]![1], depth: GUARD_TOWER.depth, kind: "guard", width: GUARD_TOWER.width, windows: [],
  x: posts[0]![0], z: posts.reduce((sum, post) => sum + post[2], 0) / posts.length
});

/** Tower plans of a military recipe (final coordinates), or none for other buildings. */
export const militaryTowerPlans = (typeId: number, recipe: BuildingRecipe): TowerPlan[] => {
  const posts = recipe.archerPositions ?? [];
  if (typeId === 9) return fortressTowerPlans();
  if (typeId === 4 && posts.length) return [watchtowerPlan(posts)];
  if (typeId === 2 && posts.length) return [guardPlan(posts)];
  return [];
};
