import { Vector3, type SkinnedMesh } from "three";

import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import { createHatchAuditAssets } from "./catapult-hatch-assets";
import { findClothCuffs } from "./cloth-cuff-apertures";

const assets = await createHatchAuditAssets({ armourFolder: process.argv[2] ?? "armour-sewn-owner-z" });
try {
  for (const id of ["roman-man-grey", "viking-man-blond"]) {
    const nation = id.startsWith("roman") ? "roman" : "viking";
    const worker = await assets.soldier(nation, id, "recruit", false);
    worker.root.scale.setScalar(WORKER_SCALE); worker.root.updateMatrixWorld(true);
    const node = worker.root.getObjectByName("armour_underclothes_lod0") as SkinnedMesh;
    for (const cuff of findClothCuffs(node)) {
      const start = worker.root.getObjectByName(`${cuff.side}Arm`)!.getWorldPosition(new Vector3());
      const axis = worker.root.getObjectByName(`${cuff.side}ForeArm`)!.getWorldPosition(new Vector3()).sub(start);
      const length = axis.length(), direction = axis.clone().normalize();
      const u = new Vector3(0, 0, 1).cross(direction).normalize(), v = direction.clone().cross(u);
      const position = node.geometry.getAttribute("position");
      const local = cuff.vertices.map(vertex => node.applyBoneTransform(vertex,
        new Vector3().fromBufferAttribute(position, vertex)).applyMatrix4(node.matrixWorld).sub(start));
      const angles = local.map(point => Math.atan2(point.dot(v), point.dot(u)));
      const steps = angles.map((angle, index) => Math.atan2(Math.sin(angles[(index + 1) % angles.length]! - angle),
        Math.cos(angles[(index + 1) % angles.length]! - angle)));
      const winding = steps.reduce((sum, value) => sum + value, 0), sign = Math.sign(winding);
      console.log(JSON.stringify({ id, side: cuff.side, vertices: angles.length,
        fraction: local.reduce((sum, point) => sum + point.dot(direction) / length / local.length, 0),
        winding, totalTurn: steps.reduce((sum, value) => sum + Math.abs(value), 0),
        backwardEdges: steps.filter(step => step * sign < -1e-4).length }));
    }
    worker.dispose();
  }
} finally { assets.restore(); }
