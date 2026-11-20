import { toBarkUv } from "../trees/bark-uv";
import { addCacaoLeaf } from "./drink-crops/cacao-tree";
import { solid } from "./drink-crops/crop-mesh-parts";
import { MeshBuilder, type Vec3 } from "./mesh-builder";
import { addCurvedTube } from "./tree-parts";

/** A rooted young broadleaf tree: slender leader, connected lateral shoots and individual blades. */
export const createNurserySaplingMesh = (detailed: boolean) => {
  const builder = new MeshBuilder(), bark = solid([.13, .085, .04]);
  const leader: Vec3[] = detailed ? [[0, 0, 0], [.006, .17, -.005], [0, .36, .006]]
    : [[0, 0, 0], [0, .36, .006]];
  addCurvedTube(builder, leader, detailed ? [.014, .009, .003] : [.014, .003],
    detailed ? 6 : 3, bark, undefined, (ring, around) => toBarkUv(around, ring * 2));
  // Shelf saplings are only .36 units tall: retain connected shoots and real leaf contours,
  // rather than spending mature-tree tessellation on each of six nursery plants.
  const branches = detailed ? 3 : 2, leaves = detailed ? 2 : 1;
  for (let branch = 0; branch < branches; branch++) {
    const yaw = branch * 2.39996, y = .12 + branch * .045;
    const tip: Vec3 = [Math.sin(yaw) * .065, y + .06, Math.cos(yaw) * .065];
    addCurvedTube(builder, [[0, y, 0], tip], [.006, .002], detailed ? 5 : 3, bark,
      undefined, (ring, around) => toBarkUv(around, 3 + ring));
    for (let leaf = 0; leaf < leaves; leaf++) {
      const t = .3 + leaf / leaves * .65;
      addCacaoLeaf(builder, [tip[0] * t, y + .06 * t, tip[2] * t],
        yaw + (leaf % 2 ? .8 : -.8), .085 + leaf * .008, branch === branches - 1, detailed);
    }
  }
  return builder.finish({ contactRadius: .05, flex: .15 });
};
