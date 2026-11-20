/**
 * T07 review spots, evaluated inside the page (self-contained: no imports, only `debug`): a meadow,
 * a village path, a field edge and a shore near the possessed start, chosen from the cover field,
 * the roads, the fields and the heights of the loaded island.
 */
export interface ReviewSpot {
  name: string;
  /** Overrides the run's pitch (radians, up positive). */
  pitch?: number;
  x: number;
  yaw: number;
  z: number;
}

export const findReviewSpots = async (): Promise<ReviewSpot[]> => {
  const debug = (window as any).__atmosphereLiveDebug;
  const load = (path: string) => import(/* @vite-ignore */ path);
  const { buildCoverField } = await load("/src/render-common/props/cover-field.ts");
  const { sampleSmooth } = await load("/src/shared/world/grid-geometry.ts");
  const world = debug.world, frame = debug.possessedFrame;
  const start = frame.exploration.camera.pose;
  const field = buildCoverField(world);
  const cover = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) return 0;
    return field.pixels[Math.floor(z) * world.cellsX + Math.floor(x)] / 255;
  };
  const isWater = (x: number, z: number) => sampleSmooth(world, world.heights, x, z) < world.seaLevel;
  const buildings = (frame.buildings ?? []) as { x: number; z: number }[];
  const nearBuilding = (x: number, z: number, radius: number) =>
    buildings.some(building => Math.hypot(building.x - x, building.z - z) < radius);
  const rayCover = (x: number, z: number, yaw: number) => {
    let sum = 0;
    for (let step = 2; step <= 14; step += 1.5) sum += cover(x + Math.sin(yaw) * step, z + Math.cos(yaw) * step);
    return sum;
  };
  const bestYaw = (x: number, z: number) => {
    let best = 0, bestScore = -1;
    for (let index = 0; index < 24; index++) {
      const yaw = (index / 24) * Math.PI * 2, score = rayCover(x, z, yaw);
      if (score > bestScore) { best = yaw; bestScore = score; }
    }
    return best;
  };
  const near = (x: number, z: number) => Math.hypot(x - start.x, z - start.z);
  const props = world.props as { count: number; types: Uint8Array; x: Float32Array; z: Float32Array };
  const nearProp = (x: number, z: number, radius: number) => {
    for (let id = 0; id < props.count; id++)
      if (props.types[id] !== 255 && Math.abs(props.x[id]! - x) < radius && Math.abs(props.z[id]! - z) < radius)
        return true;
    return false;
  };
  const spots: ReviewSpot[] = [];

  let meadow = { score: -1, x: start.x, z: start.z };
  for (let z = start.z - 90; z < start.z + 90; z += 2) for (let x = start.x - 90; x < start.x + 90; x += 2) {
    if (cover(x, z) < 0.5 || nearBuilding(x, z, 10) || !nearBuilding(x, z, 28) || nearProp(x, z, 3)) continue;
    let sum = 0;
    for (let dz = -6; dz <= 6; dz += 2) for (let dx = -6; dx <= 6; dx += 2) sum += cover(x + dx, z + dz);
    const score = sum - near(x, z) * 0.02;
    if (score > meadow.score) meadow = { score, x, z };
  }
  const meadowYaw = bestYaw(meadow.x, meadow.z);
  spots.push({ name: "meadow", x: meadow.x, yaw: meadowYaw, z: meadow.z });
  // Worst case for the ring's fill: looking down into the meadow, blades fill the view.
  spots.push({ name: "meadow-down", pitch: -0.5, x: meadow.x, yaw: meadowYaw, z: meadow.z });

  let path: ReviewSpot | null = null, pathScore = -1;
  type Road = { doorway?: boolean; end: { x: number; z: number }; start: { x: number; z: number } };
  for (const road of (frame.roads ?? debug.roads ?? []) as Road[]) {
    const dx = road.end.x - road.start.x, dz = road.end.z - road.start.z, length = Math.hypot(dx, dz);
    if (length < 0.9) continue;
    const midX = (road.start.x + road.end.x) / 2, midZ = (road.start.z + road.end.z) / 2;
    const sideX = -dz / length, sideZ = dx / length;
    const sides = Math.min(cover(midX + sideX * 3, midZ + sideZ * 3), cover(midX - sideX * 3, midZ - sideZ * 3));
    const score = sides * 4 - near(midX, midZ) * 0.01 - (nearBuilding(midX, midZ, 5) ? 2 : 0);
    if (score > pathScore) {
      pathScore = score;
      // Stand back along the lane so the path, its verges and the doorway are in view.
      const back = road.doorway ? 6 : 0;
      path = { name: "village-path", x: road.start.x - (dx / length) * back, yaw: Math.atan2(dx, dz),
        z: road.start.z - (dz / length) * back };
    }
  }
  // Without live road segments: a dirt/gravel track (splat at vertices) with meadow on both sides.
  const DIRT = 3, GRAVEL = 7, MATERIALS = 9;
  const trackWeight = (x: number, z: number) => {
    const vertex = (Math.round(z) * (world.cellsX + 1) + Math.round(x)) * MATERIALS;
    return (world.splat[vertex + DIRT] + world.splat[vertex + GRAVEL]) / 255;
  };
  for (let z = start.z - 90; z < start.z + 90; z += 1) for (let x = start.x - 90; x < start.x + 90; x += 1) {
    if (trackWeight(x, z) < 0.6 || !nearBuilding(x, z, 25) || nearBuilding(x, z, 6)) continue;
    for (const yaw of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
      const sideX = Math.cos(yaw) * 3, sideZ = -Math.sin(yaw) * 3;
      const sides = Math.min(cover(x + sideX, z + sideZ), cover(x - sideX, z - sideZ));
      const ahead = trackWeight(x + Math.sin(yaw) * 4, z + Math.cos(yaw) * 4);
      const score = sides * 4 + ahead - near(x, z) * 0.01;
      if (sides > 0.35 && ahead > 0.5 && score > pathScore) {
        pathScore = score;
        path = { name: "village-path", x, yaw, z };
      }
    }
  }
  if (path) spots.push(path);

  let edge: ReviewSpot | null = null, edgeScore = -1;
  for (const plot of (frame.fields ?? []) as { x: number; z: number }[]) {
    for (let index = 0; index < 8; index++) {
      const angle = (index / 8) * Math.PI * 2;
      const x = plot.x + Math.sin(angle) * 5, z = plot.z + Math.cos(angle) * 5;
      const score = cover(x, z) + cover(x + Math.sin(angle) * 2, z + Math.cos(angle) * 2) - near(x, z) * 0.005;
      if (score > edgeScore) { edgeScore = score; edge = { name: "field-edge", x, yaw: angle + Math.PI, z }; }
    }
  }
  if (edge) spots.push(edge);

  let shore: ReviewSpot | null = null, shoreScore = -1;
  for (let z = start.z - 120; z < start.z + 120; z += 2) for (let x = start.x - 120; x < start.x + 120; x += 2) {
    if (cover(x, z) < 0.45 || isWater(x, z) || nearBuilding(x, z, 12) || !nearBuilding(x, z, 30)) continue;
    for (let index = 0; index < 12; index++) {
      const yaw = (index / 12) * Math.PI * 2;
      if (!isWater(x + Math.sin(yaw) * 9, z + Math.cos(yaw) * 9)) continue;
      const score = cover(x, z) + rayCover(x, z, yaw + Math.PI) * 0.05 - near(x, z) * 0.002;
      if (score > shoreScore) { shoreScore = score; shore = { name: "shore", x, yaw, z }; }
    }
  }
  if (shore) spots.push(shore);
  return spots;
};
