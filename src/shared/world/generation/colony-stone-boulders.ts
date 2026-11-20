import { COLONY_STONE_BOULDER_COUNT } from "../../balance/resources";
import { placeProp } from "../editing/prop-placement";
import { createRandom, deriveSeed, shuffle } from "../rng";
import { BUILD, PROP, PROP_REMOVED, type WorldData } from "../world-data";

const SITE_RADIUS = 1;
/** Mine plots extend past their zone's ore cells; a boulder keeps out of the whole mining shelf. */
const MINE_CLEARANCE = 4;
/** The harbour is placed nearest the start: its plot, approach and first roads stay clear. */
const START_CLEARANCE = 14;
const PROP_CLEARANCE = 1.5;
const BOULDER_SPACING = 10;
const NO_COMPONENT = -1;

const countBoulders = (world: WorldData) => {
  let count = 0;
  for (let id = 0; id < world.props.count; id++) if (world.props.types[id] === PROP.largeRock) count++;
  return count;
};

/** Walkable land cells of the biggest connected landmass (4-neighbour flood fill). */
const findMainLand = (world: WorldData) => {
  const { cellsX, walkCost } = world;
  const component = new Int32Array(walkCost.length).fill(NO_COMPONENT);
  const queue = new Int32Array(walkCost.length);
  let best = NO_COMPONENT, bestSize = 0;
  for (let first = 0; first < component.length; first++) {
    if (!walkCost[first] || component[first] !== NO_COMPONENT) continue;
    let head = 0, tail = 0;
    const visit = (next: number) => {
      if (!walkCost[next] || component[next] !== NO_COMPONENT) return;
      component[next] = first; queue[tail++] = next;
    };
    visit(first);
    while (head < tail) {
      const cell = queue[head++]!, x = cell % cellsX;
      if (cell >= cellsX) visit(cell - cellsX);
      if (cell + cellsX < component.length) visit(cell + cellsX);
      if (x > 0) visit(cell - 1);
      if (x < cellsX - 1) visit(cell + 1);
    }
    if (tail > bestSize) { best = first; bestSize = tail; }
  }
  return (cell: number) => best !== NO_COMPONENT && component[cell] === best;
};

const isNearMine = (world: WorldData, x: number, z: number) => {
  const { cellsX, cellsZ } = world;
  for (let cz = Math.max(0, z - MINE_CLEARANCE); cz <= Math.min(cellsZ - 1, z + MINE_CLEARANCE); cz++)
    for (let cx = Math.max(0, x - MINE_CLEARANCE); cx <= Math.min(cellsX - 1, x + MINE_CLEARANCE); cx++)
      if (world.mineZone[cz * cellsX + cx]) return true;
  return false;
};

/** An open, buildable 3 x 3 patch away from mines and the landing (no mine plot, harbour or pass). */
const isOpenSite = (world: WorldData, onMainLand: (cell: number) => boolean, x: number, z: number) => {
  for (let dz = -SITE_RADIUS; dz <= SITE_RADIUS; dz++) for (let dx = -SITE_RADIUS; dx <= SITE_RADIUS; dx++) {
    const cell = (z + dz) * world.cellsX + x + dx;
    const build = world.buildClass[cell]!;
    if (!onMainLand(cell) || build < BUILD.small || build > BUILD.large) return false;
  }
  if (Math.hypot(x + .5 - world.start.x, z + .5 - world.start.z) < START_CLEARANCE) return false;
  return !isNearMine(world, x, z);
};

const isClearOfProps = (world: WorldData, x: number, z: number) => {
  const { props } = world;
  for (let id = 0; id < props.count; id++)
    if (props.types[id] !== PROP_REMOVED && Math.hypot(props.x[id]! - x, props.z[id]! - z) < PROP_CLEARANCE)
      return false;
  return true;
};

/**
 * Generated islands have no large rocks, so a fresh tiered colony would get no stone source.
 * Places the missing boulders on open main-land patches (seeded, spread apart) before they are
 * promoted. Worlds that already carry enough boulders (editor maps) are left untouched.
 */
export const placeColonyStoneBoulders = (world: WorldData) => {
  let missing = COLONY_STONE_BOULDER_COUNT - countBoulders(world);
  if (missing <= 0) return;
  const onMainLand = findMainLand(world);
  const random = createRandom(deriveSeed(world.seed, "colony-stone-boulders-v1"));
  const sites: Array<{ x: number; z: number }> = [];
  for (let z = SITE_RADIUS + 1; z < world.cellsZ - SITE_RADIUS - 1; z += 2)
    for (let x = SITE_RADIUS + 1; x < world.cellsX - SITE_RADIUS - 1; x += 2)
      if (isOpenSite(world, onMainLand, x, z)) sites.push({ x: x + .5, z: z + .5 });
  const placed: Array<{ x: number; z: number }> = [];
  for (const site of shuffle(sites, random)) {
    if (placed.some(other => Math.hypot(other.x - site.x, other.z - site.z) < BOULDER_SPACING)) continue;
    if (!isClearOfProps(world, site.x, site.z)) continue;
    const index = placeProp(world, { kind: PROP.largeRock, seed: Math.floor(random() * 2 ** 31), ...site });
    if (typeof index !== "number") continue;
    placed.push(site);
    if (--missing === 0) return;
  }
};
