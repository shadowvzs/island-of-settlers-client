import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type SkinnedMesh, Vector3 } from "three";

import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import { applyArmourPoseSnapshot } from "./armour-pose-snapshot";
import { createHatchAuditAssets } from "./catapult-hatch-assets";

const { values } = parseArgs({ options: { review: { type: "string" }, out: { type: "string" } } });
if (!values.review || !values.out) throw new Error("Choose the exact native review and output receipt");
const input = JSON.parse(await readFile(values.review, "utf8")), records = [];
for (const record of input.records) {
  const bytes = await readFile(record.modelPath);
  if (createHash("sha256").update(bytes).digest("hex") !== record.modelSha256)
    throw new Error("Native model hash changed; recapture before ownership analysis");
  const folder = record.modelPath.split("game_ready/")[1]!.split("/")[0]!;
  const assets = await createHatchAuditAssets({ armourFolder: folder });
  try {
    const worker = await assets.soldier(record.nation, record.body, record.rank, record.quality === "minimal");
    worker.root.scale.setScalar(WORKER_SCALE); worker.setLod(record.quality === "minimal" ? 1 : 0);
    worker.root.updateMatrixWorld(true);
    const rest = new Map<SkinnedMesh, Vector3[]>();
    worker.root.traverse(node => {
      const mesh = node as SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      rest.set(mesh, Array.from({ length: mesh.geometry.getAttribute("position").count }, (_, vertex) =>
        mesh.applyBoneTransform(vertex, new Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), vertex))
          .applyMatrix4(mesh.matrixWorld)));
    });
    for (const cell of record.cells.filter((cell: any) => cell.name === "impact back" && cell.troop === "archer")) {
      applyArmourPoseSnapshot(worker.root, cell.diagnostics);
      const owners = cell.diagnostics.owners.filter((owner: any) => owner.name.startsWith("armour_underclothes")
        && owner.pixel[0] >= 96 && owner.pixel[0] <= 176 && owner.pixel[1] <= 176).map((owner: any) => {
        const mesh = worker.root.getObjectByName(owner.name) as SkinnedMesh;
        return { ...owner, rest: owner.vertices.map((vertex: number) => rest.get(mesh)![vertex]!.toArray()),
          skin: owner.vertices.map((vertex: number) => [0, 1, 2, 3].flatMap(slot => {
            const weight = mesh.geometry.getAttribute("skinWeight").getComponent(vertex, slot);
            const joint = mesh.geometry.getAttribute("skinIndex").getComponent(vertex, slot);
            return weight ? [[mesh.skeleton.bones[joint]!.name, weight]] : [];
          })) };
      });
      records.push({ body: record.body, quality: record.quality, modelSha256: record.modelSha256,
        troop: cell.troop, owners });
      console.log(JSON.stringify(records.at(-1)));
    }
    worker.dispose();
  } finally { assets.restore(); }
}
await writeFile(resolve(values.out), JSON.stringify({ scope: "Exact final equipped native snapshots and SHA-matched assets. Visible cloth witnesses mapped to rest geometry and original cloth skin; no mutation.", records }, null, 2));
