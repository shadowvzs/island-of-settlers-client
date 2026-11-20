import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { RENDER_SUBDIVISION } from "../chunk-sampling";
import type { Vec3 } from "./mesh-builder";
import type { RawInstance } from "./prop-instances";
import { PROP_MESH_SEED } from "./prop-mesh-seed";
import { createPropMesh, getMeshKind, getMeshVariant } from "./prop-meshes";
import { listShoreShellSpots, type ShoreShellSpot } from "./shore-shell-spots";
import { getContactPoints, getRestHeight, type RestPose } from "./shore-rest";

/** Slope sampling step (cells) for the terrain normal. */
const SLOPE_STEP = 0.15;

/**
 * Height of the rendered terrain: the chunk mesh samples sampleSmooth on a grid of
 * 1 / RENDER_SUBDIVISION cells and interpolates between those vertices.
 */
const sampleRenderedHeight = (world: WorldData, x: number, z: number) => {
  const step = 1 / RENDER_SUBDIVISION;
  const left = Math.floor(x / step) * step, top = Math.floor(z / step) * step;
  const fx = (x - left) / step, fz = (z - top) / step;
  const at = (px: number, pz: number) => sampleSmooth(world, world.heights, px, pz);
  const near = at(left, top) * (1 - fx) + at(left + step, top) * fx;
  const far = at(left, top + step) * (1 - fx) + at(left + step, top + step) * fx;
  return near * (1 - fz) + far * fz;
};

/** Unit terrain normal (x, z) from central differences of the rendered height. */
const getGroundTilt = (world: WorldData, x: number, z: number): [number, number] => {
  const height = (px: number, pz: number) => sampleRenderedHeight(world, px, pz);
  const slopeX = (height(x + SLOPE_STEP, z) - height(x - SLOPE_STEP, z)) / (2 * SLOPE_STEP);
  const slopeZ = (height(x, z + SLOPE_STEP) - height(x, z - SLOPE_STEP)) / (2 * SLOPE_STEP);
  const length = Math.hypot(slopeX, 1, slopeZ);
  return [-slopeX / length, -slopeZ / length];
};

/** Contact points (mesh vertices) of every shell mesh id, built once from the native meshes. */
const contactPoints = new Map<number, Vec3[]>();
const getMeshContact = (meshId: number) => {
  let points = contactPoints.get(meshId);
  if (points) return points;
  const mesh = createPropMesh(PROP_MESH_SEED, getMeshKind(meshId), getMeshVariant(meshId));
  points = getContactPoints(mesh.positions, mesh.height);
  contactPoints.set(meshId, points);
  return points;
};

/**
 * A shell resting on the beach: tilted to the terrain normal, its lowest mesh point (in its
 * yaw and tilt) just above the rendered sand.
 */
const restShell = (world: WorldData, spot: ShoreShellSpot, x: number, z: number): RawInstance => {
  const pose: RestPose = { rotation: spot.rotation, scale: spot.scale, tilt: getGroundTilt(world, x, z) };
  const y = getRestHeight(getMeshContact(spot.meshId), pose, { x, z },
    (px, pz) => sampleRenderedHeight(world, px, pz));
  return { ...pose, meshId: spot.meshId, phase: 0, sourceIndex: -1, stretch: 1, tint: spot.tint, x, y, z };
};

/** Collected shells that reappeared elsewhere: shell index -> new ground position. */
const readMoves = (world: WorldData) => {
  const moves = new Map<number, { x: number; z: number }>();
  const flat = world.shoreShellMoves ?? [];
  for (let at = 0; at + 2 < flat.length; at += 3) moves.set(flat[at]!, { x: flat[at + 1]!, z: flat[at + 2]! });
  return moves;
};

/**
 * Render instances of the shore shells (render only, not gameplay geometry): every listed shell
 * at its place, or where it reappeared after being collected (world.shoreShellMoves).
 */
export const collectShoreDetails = (world: WorldData): RawInstance[] => {
  const moves = readMoves(world);
  return listShoreShellSpots(world).map((spot, index) => {
    const moved = moves.get(index);
    return restShell(world, spot, moved?.x ?? spot.x, moved?.z ?? spot.z);
  });
};
