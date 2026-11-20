import { type Camera, type Scene, Vector3 } from "three";

import type { CinematicPoint, CinematicViewLimits } from "../../../render-common/cinematic/cinematic-frame";
import type { FrameState } from "../../../render-common/renderer-contract";
import { createDrawnCameraPose } from "./drawn-camera-pose";
import { applyCameraShake, createThreeCinematicCamera } from "./three-cinematic-camera";
import { createThreeRegionGlint } from "./three-region-glint";

type GroundHeight = (x: number, z: number) => number;

export interface CinematicViewOptions {
  cellsX: number;
  cellsZ: number;
  /** Camera ground (sea level over water, bridge decks): eye clearance and glint height. */
  groundHeight: GroundHeight;
  limits: Readonly<CinematicViewLimits>;
  /** The RTS rig's eased target height (the iso view aims at it). */
  rtsTargetHeight: () => number;
  scene: Scene;
}

export interface CinematicViewResult {
  /** Weight of the cinematic override this frame (0 without one). */
  blend: number;
  camera: Camera;
  /** The frame the rest of the renderer draws: the RTS camera swapped for the LOD stand-in on override. */
  frame: FrameState;
  /** True while the override draws (the RTS rig's view mode does not apply). */
  overriding: boolean;
}

/**
 * CIN2 camera selection (cinematic > exploration > RTS rig), shake (only while the override draws), the
 * drawn-pose record and the area glints. Ordinary frames without `cinematic` pass straight through without allocating.
 */
export const createCinematicView = ({
  cellsX,
  cellsZ,
  groundHeight,
  limits,
  rtsTargetHeight,
  scene
}: CinematicViewOptions) => {
  const rig = createThreeCinematicCamera({ cellsX, cellsZ, groundHeight, limits });
  const drawnPose = createDrawnCameraPose(groundHeight);
  const glint = createThreeRegionGlint({ cellsX, groundHeight, spritesPerArea: limits.glintSprites });
  scene.add(glint.mesh);
  const rtsTarget: CinematicPoint = { x: 0, y: 0, z: 0 };
  const rtsTargetVector = new Vector3();
  const result: CinematicViewResult = { blend: 0, camera: rig.camera, frame: {} as FrameState, overriding: false };

  /** `underlying`: the camera exploration or the RTS rig produced this frame; `exploring`: which one. */
  const resolve = (input: FrameState, underlying: Camera, exploring: boolean): CinematicViewResult => {
    rtsTarget.x = input.camera.centerX;
    rtsTarget.y = rtsTargetHeight();
    rtsTarget.z = input.camera.centerZ;
    const sample = rig.update(input.cinematic, input.camera, underlying, rtsTarget);
    const camera = sample?.camera ?? underlying;
    // Shake belongs to the cinematic shot (CIN6): no override, no shake on the player's own camera.
    if (sample) applyCameraShake(camera, input.cinematic?.shake);
    glint.update(input.cinematic?.glints, input.time);
    let focus: number | null = null;
    if (!exploring) focus = camera.position.distanceTo(rtsTargetVector.set(rtsTarget.x, rtsTarget.y, rtsTarget.z));
    if (sample) focus = sample.focusDistance;
    drawnPose.record(camera, focus, input.camera, rtsTarget);
    result.blend = sample?.blend ?? 0;
    result.camera = camera;
    result.overriding = sample !== null;
    // Exploration keeps its eye-centred LOD; the RTS path gets the cinematic framing's centre and zoom.
    result.frame = sample && !exploring ? { ...input, camera: sample.lodCamera } : input;
    return result;
  };

  return {
    currentCameraPose: drawnPose.read,
    dispose: glint.dispose,
    glintSprites: glint.sprites,
    resolve,
    setWarming: glint.setWarming
  };
};
