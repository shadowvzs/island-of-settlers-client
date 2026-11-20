import type { Point3 } from "../building-recipe";
import type { WallRun } from "../nation-kit-classify";
import { boxOf, groundWalls, isFree, type LevelKit, onWallFace, wallFace } from "./level-kit";

/**
 * Level 5 Nubian painted frieze: a cream band with a zigzag of indigo and red-ochre triangles round
 * the upper walls,
 * under the raised band, painted on the wall's actual (thicker than plan) face and stopping at
 * buttresses, windows and anything else standing proud of it.
 */
const CREAM: Point3 = [.9, .82, .62];
const INDIGO: Point3 = [.16, .26, .5];
const RED_OCHRE: Point3 = [.6, .24, .14];
const TILE = { height: .1, width: .12 } as const;
/** The cream band behind the triangles (a little taller than they are). */
const BAND_HEIGHT = .13;
/** Standoffs past the plan face tried for the wall's real face, and the sample points along it. */
const STANDOFF = { max: .16, step: .01 } as const;
const SAMPLES = [.25, .5, .75];

/** Frieze centre height: under the raised band, else a little under the wall top. */
const friezeY = (kit: LevelKit, wall: WallRun) => {
  const lift = kit.site.lift, top = wall.base + wall.height;
  return (lift ? Math.min(lift.cut, top) : top) - .1;
};

/** A thin probe box `out` past the plan face at fraction `t` along the wall. */
const tileBox = (kit: LevelKit, wall: WallRun, t: number, y: number, out: number) => {
  const centre = onWallFace(kit.site, wall, t, y, out + .006), size: Point3 = [.01, TILE.height, .01];
  size[wall.along] = TILE.width;
  return boxOf(centre, size);
};

/** The wall's real face: the least standoff free at most sample points (null when none is). */
const realFace = (kit: LevelKit, wall: WallRun, y: number) => {
  const found = SAMPLES.flatMap(t => {
    for (let out = 0; out <= STANDOFF.max; out += STANDOFF.step)
      if (isFree(kit.site, tileBox(kit, wall, t, y, out), .002)) return [out];
    return [];
  });
  return found.length ? Math.min(...found) : null;
};

/** Tile indices along a wall whose spot on the real face is free, grouped into contiguous runs. */
const freeRuns = (kit: LevelKit, wall: WallRun, y: number, out: number) => {
  const runs: number[][] = [], count = Math.floor(wall.length / (TILE.width / 2)) - 1;
  let run: number[] = [];
  for (let index = 1; index < count; index++) {
    if (isFree(kit.site, tileBox(kit, wall, tileT(wall, index), y, out), .002)) {
      run.push(index);
      continue;
    }
    if (run.length > 1) runs.push(run);
    run = [];
  }
  if (run.length > 1) runs.push(run);
  return runs;
};

const tileT = (wall: WallRun, index: number) => index * TILE.width / 2 / wall.length;

/** One run: a cream band painted on the face, a zigzag of indigo (up) and red-ochre (down) triangles on it. */
const paintRun = (kit: LevelKit, wall: WallRun, run: readonly number[], y: number, out: number) => {
  const { axis, sign } = wallFace(kit.site, wall), first = tileT(wall, run[0]!), last = tileT(wall, run.at(-1)!);
  // The band ends half a tile past the outer triangles, but never past the plot line.
  const limit = wall.along === 0 ? kit.site.limit.extentX : kit.site.limit.extentZ;
  const start = wall.min[wall.along]!, half = TILE.width / 2;
  const from = Math.max(-limit, start + first * wall.length - half);
  const to = Math.min(limit, start + last * wall.length + half);
  const position = onWallFace(kit.site, wall, first, y, out + .003), band: Point3 = [0, BAND_HEIGHT, 0];
  position[wall.along] = (from + to) / 2;
  band[axis] = .006;
  band[wall.along] = to - from;
  kit.add({ position, shape: "box", size: band, stage: 4, surface: "paint", tint: CREAM });
  const normal: Point3 = [0, 0, 0];
  normal[axis] = sign;
  const yaw = Math.atan2(normal[0], normal[2]);
  for (const index of run) {
    const up = index % 2 === 0, position = onWallFace(kit.site, wall, tileT(wall, index), y, out + .0075);
    const rotation: Point3 = up ? [0, yaw, 0] : [Math.PI, yaw + Math.PI, 0];
    kit.add({ position, rotation, shape: "paint-triangle", size: [TILE.width, TILE.height, .01], stage: 4,
      surface: "paint", tint: up ? INDIGO : RED_OCHRE });
  }
};

/** The painted frieze along one wall, on its real face, broken where something stands proud of it. */
const paintWall = (kit: LevelKit, wall: WallRun) => {
  const y = friezeY(kit, wall);
  if (y - BAND_HEIGHT / 2 < kit.site.door.top + .06) return;
  const out = realFace(kit, wall, y);
  if (out === null) return;
  for (const run of freeRuns(kit, wall, y, out)) paintRun(kit, wall, run, y, out);
};

/** The frieze round every ground wall (a band per run, one triangle per tile: cheap enough for Minimal). */
export const addPaintedFrieze = (kit: LevelKit) => {
  for (const wall of groundWalls(kit.site, .5)) paintWall(kit, wall);
};
