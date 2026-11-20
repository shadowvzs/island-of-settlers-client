import { CROWD_JOINTS } from "@workers/character-lods/lod-policy";
import { type Color, Matrix4, type Object3D } from "three";

import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import type { WorkerDetail } from "./worker-detail";
import type { CrowdPoseRows } from "./worker-gpu-bake";
import type { CrowdBodySource, CrowdInstances } from "./worker-gpu-instances";
import {
  CROWD_STATE_BLEND_SECONDS, crowdClipSeconds, crowdPoseKey, crowdPoseRequest, crowdPoseRow
} from "./worker-gpu-pose";

/**
 * C06: one crowd member's hand-over to the instanced GPU body. While active, the member's skinned
 * LOD3 meshes are hidden, its instance is pushed every frame, and on the member's cadence frames its
 * crowd bones are posed from the bake on the CPU so held tools, cargo and headwear keep following
 * the hands and head. Leaving restores the skinned path untouched.
 */
export const createGpuCrowdMember = (
  worker: { crowd?: CrowdBodySource; root: Object3D },
  detail: WorkerDetail,
  instances: CrowdInstances
) => {
  const type = instances.typeFor(worker.crowd);
  if (!type) return undefined;
  const pose: CrowdPoseRows = { mix: 0, previousRow: 0, previousWeight: 0, rowA: 0, rowB: 0 };
  const rootWorld = new Matrix4();
  let bones: (Object3D | undefined)[] | undefined;
  let active = false;
  let key = "";
  let blendStart = -Infinity;
  let previousRow = 0;

  const setActive = (on: boolean) => {
    if (on === active) return;
    active = on;
    detail.setGpuDrawn(on);
    bones ??= CROWD_JOINTS.map(name => worker.root.getObjectByName(name));
    for (const bone of bones) if (bone) bone.matrixWorldAutoUpdate = !on;
    // A later re-entry starts from the frame's own pose, without a blend from a stale row.
    if (!on) key = "";
  };

  /** The skinned path's 0.2 s state blend: the last primary row fades out under the new pose. */
  const trackStateBlend = (frame: WorkerFrame, time: number) => {
    const next = crowdPoseKey(frame);
    if (next !== key) {
      if (key) { previousRow = pose.rowA; blendStart = time; }
      key = next;
    }
    const fraction = (time - blendStart) / CROWD_STATE_BLEND_SECONDS;
    pose.previousRow = previousRow;
    pose.previousWeight = fraction < 1 ? 1 - Math.max(0, fraction) : 0;
  };

  return {
    isActive: () => active,
    /** Resolves this frame's rows and activates; false when the frame must take the skinned path. */
    resolve: (frame: WorkerFrame, time: number) => {
      const bake = type.bake;
      if (!bake || !type.ready()) return false;
      const request = crowdPoseRequest(frame);
      const rangeA = bake.range(request.clip);
      if (!rangeA) return false;
      const rangeB = request.blendClip === undefined ? undefined : bake.range(request.blendClip);
      if (request.blendClip !== undefined && !rangeB) return false;
      trackStateBlend(frame, time);
      pose.rowA = crowdPoseRow(rangeA, crowdClipSeconds(request, request.time, rangeA.duration), request.clamp);
      pose.rowB = rangeB
        ? crowdPoseRow(rangeB, crowdClipSeconds(request, request.blendTime ?? 0, rangeB.duration)) : pose.rowA;
      pose.mix = rangeB ? request.weight : 0;
      setActive(true);
      return true;
    },
    /** After `present` placed the group and root: this frame's body instance. */
    push: (tint: Color) => {
      worker.root.updateWorldMatrix(false, false);
      rootWorld.copy(worker.root.matrixWorld);
      type.push(rootWorld, pose, tint);
    },
    /** Cadence frame: the crowd bones' world matrices for the props and headwear under them. */
    poseSockets: () => { if (bones) type.bake?.poseCrowdBones(bones, rootWorld, pose); },
    leave: () => setActive(false),
    dispose: () => setActive(false)
  };
};

export type GpuCrowdMember = NonNullable<ReturnType<typeof createGpuCrowdMember>>;
