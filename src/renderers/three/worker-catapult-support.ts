import { type Object3D, type SkinnedMesh, Vector3 } from "three";

import type { WorkerFrame } from "../../render-common/workers/worker-unit";

/** Calibrate this rig once on the actual raised floor; retain its authored walking foot lift. */
export const createWorkerCatapultSupport = (root: Object3D) => {
  const baseY = root.position.y, point = new Vector3();
  let offset: number | undefined;
  return {
    present: (frame: WorkerFrame) => { root.position.y = baseY + (frame.catapultStoneDiameter ? offset ?? 0 : 0); },
    capture: (frame: WorkerFrame) => {
      if (!frame.catapultStoneDiameter || offset !== undefined || frame.wareTransfer || frame.catapultHands ||
        frame.action !== "idle_breathe") return;
      root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
      let sole = Infinity;
      root.traverse(node => {
        const mesh = node as SkinnedMesh;
        if (!mesh.isSkinnedMesh) return;
        const indices = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
        if (!indices || !weights) return;
        for (let vertex = 0; vertex < indices.count; vertex++) {
          let footWeight = 0;
          for (let slot = 0; slot < 4; slot++) {
            const joint = indices.getComponent(vertex, slot), bone = mesh.skeleton.bones[joint]?.name ?? "";
            if (/(Left|Right)(Foot|Toe)/.test(bone)) footWeight += weights.getComponent(vertex, slot);
          }
          if (footWeight < .6) continue;
          mesh.getVertexPosition(vertex, point); mesh.localToWorld(point); sole = Math.min(sole, point.y);
        }
      });
      if (!Number.isFinite(sole)) return;
      offset = Math.max(-.12, Math.min(.12, frame.y - sole + .001));
      root.position.y = baseY + offset; root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
    }
  };
};
