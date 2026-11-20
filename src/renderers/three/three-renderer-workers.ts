import type { Camera, WebGLRenderer } from "three";

import type { MountFrame } from "../../render-common/mounts/mount-frame";
import type { FrameState, RendererInput } from "../../render-common/renderer-contract";
import type { WorkerAppearance } from "../../render-common/workers/worker-unit";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { CharacterTierPolicy } from "./character-tier-policy";
import { createLazyRenderLayer } from "./lazy-render-layer";
import { createThreeMounts } from "./three-mounts";
import type { CastSunShadows } from "./three-shadows";
import { createThreeWorkerCrowd, type createWorkerTextureLoader, type WorkerCrowdOptions } from "./three-worker";

type WorkerTextures = ReturnType<typeof createWorkerTextureLoader>;
type LatestWorkerFrame = Pick<FrameState, "workers" | "environment"> | undefined;

/**
 * Loads a worker crowd for the given appearances; once frames were drawn, it is prepared with the
 * latest one (recoloured to the new appearances) before it replaces the current crowd.
 */
export const createWorkerCrowdLoader = (
  workerTextures: WorkerTextures,
  detailed: boolean,
  world: RendererInput["world"],
  getLatestFrame: () => LatestWorkerFrame,
  bridgeHeight?: (x: number, z: number) => number | undefined,
  options?: WorkerCrowdOptions
) => async (appearances: readonly WorkerAppearance[]) => {
  const crowd = await createThreeWorkerCrowd(workerTextures, appearances, detailed,
    (x, z) => bridgeHeight?.(x, z) ?? sampleSmooth(world, world.heights, x, z), bridgeHeight, options);
  const latestWorkerFrame = getLatestFrame();
  if (!latestWorkerFrame || !appearances.length) return crowd;
  const frames = (latestWorkerFrame.workers ?? []).map((frame, index) => {
    if (frame.combat?.faction || frame.fallenBandit) return { ...frame };
    return { ...frame, ...appearances[(frame.actorId ?? index) % appearances.length] };
  });
  try { await crowd.prepare(frames, latestWorkerFrame.environment); }
  catch (error) { crowd.dispose(); throw error; }
  return crowd;
};

/** Mounted soldiers: their models load on the first frame that shows one (retried on failure). */
export const createCavalryLayer = (
  workerTextures: WorkerTextures,
  detailed: boolean,
  characters?: CharacterTierPolicy
) => {
  let cavalry: Awaited<ReturnType<typeof createThreeMounts>> | undefined;
  let cavalryColor = "#426eaf";
  const cavalryLayer = createLazyRenderLayer(
    () => createThreeMounts(workerTextures, [], detailed, { characters }),
    layer => { cavalry = layer; layer.setColor(cavalryColor); },
    error => { console.error("Cavalry renderer; retrying asset loading", error); }
  );
  return {
    castShadows: (cast: CastSunShadows) => { cavalry?.castShadows(cast); },
    dispose: () => { cavalryLayer.dispose(); cavalry = undefined; },
    eyeOffset: (actor: number, frame?: MountFrame) => cavalry?.eyeOffset(actor, frame),
    /** Waits for the models, then prepares them for a frame with cavalry. */
    prepare: async (mounts: readonly MountFrame[], environment: FrameState["environment"]) => {
      await cavalryLayer.whenReady();
      await cavalry?.prepare(mounts, environment);
    },
    render: (renderer: WebGLRenderer, camera: Camera) => { cavalry?.render(renderer, camera); },
    setColor: (color: string) => { cavalryColor = color; cavalry?.setColor(color); },
    stats: () => cavalry?.stats() ?? { far: 0, near: 0 },
    update: (frame: FrameState, camera?: Camera, time?: number) => {
      if (frame.cavalryMounts?.length) cavalryLayer.request();
      cavalry?.update(frame.cavalryMounts, frame.environment, camera, time ?? frame.time);
    }
  };
};
