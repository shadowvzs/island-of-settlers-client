import { NodeIO, type Primitive } from "../../../island-of-settlers-worker-generation/node_modules/@gltf-transform/core/dist/index.js";
import { ALL_EXTENSIONS } from "../../../island-of-settlers-worker-generation/node_modules/@gltf-transform/extensions/dist/index.js";
import {
  compactPrimitive, dequantize, meshopt, simplify, weld
} from "../../../island-of-settlers-worker-generation/node_modules/@gltf-transform/functions/dist/index.js";
import {
  MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier
} from "../../../island-of-settlers-worker-generation/node_modules/meshoptimizer/index.js";
import { SEAMED_MOUNT_ERROR, SEAMED_MOUNT_TRIANGLES } from "./mount-lod-policy";
import { syncVikingCommanderMountedWardrobe } from "./viking-commander-mounted-wardrobe";

/**
 * The Minimal horse and riders (`assets/mounts/<name>-minimal.glb`), simplified from the riding
 * assets of ../island-of-settlers-worker-generation/game_ready/mounts with the same skeleton, texture and UVs: the
 * Minimal detail level draws them, and a High mount swaps to them when it is small on screen
 * (src/renderers/three/mount-detail.ts). `npx tsx tools/assets/mount-lods.ts [name ...]`.
 *
 * The Nubian and Japanese bodies have many UV seams (the Japanese one is 18k triangles): the plain
 * simplifier stops near 7k there, so they collapse across the seams ("Permissive") to about 3k.
 */
const MOUNTS: readonly { name: string; seamed?: true; source: string }[] = [
  { name: "horse", source: "horse/model.glb" },
  { name: "roman-rider", source: "riders/roman-man-white/model.glb" },
  { name: "viking-rider", source: "riders/viking-woman-blue/model.glb" },
  { name: "nubian-rider", seamed: true, source: "riders/nubian-man-kilt/model.glb" },
  { name: "japanese-rider", seamed: true, source: "riders/japanese-man-linen/model.glb" }
];

const triangles = (primitive: Primitive) => primitive.getIndices()!.getCount() / 3;

/** Simplifies one primitive to `ratio` of its triangles, collapsing across UV seams. */
const simplifyAcrossSeams = (primitive: Primitive, ratio: number) => {
  const indices = primitive.getIndices()!;
  const positions = Float32Array.from(primitive.getAttribute("POSITION")!.getArray()!);
  const target = Math.floor((indices.getCount() * ratio) / 3) * 3;
  const [simplified] = MeshoptSimplifier.simplify(Uint32Array.from(indices.getArray()!), positions, 3, target,
    SEAMED_MOUNT_ERROR, ["Permissive"]);
  indices.setArray(new Uint32Array(simplified));
  compactPrimitive(primitive);
};

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder
});
const requested = process.argv.slice(2);
for (const { name, seamed, source } of MOUNTS) {
  if (requested.length && !requested.includes(name)) continue;
  const doc = await io.read(`../island-of-settlers-worker-generation/game_ready/mounts/${source}`);
  if (seamed) {
    await doc.transform(dequantize(), weld());
    const primitives = doc.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
    const ratio = SEAMED_MOUNT_TRIANGLES / primitives.reduce((sum, primitive) => sum + triangles(primitive), 0);
    primitives.forEach(primitive => simplifyAcrossSeams(primitive, ratio));
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));
  } else await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: .25, error: .015 }));
  await io.write(`assets/mounts/${name}-minimal.glb`, doc);
  console.log(`Saved ${name} skinned Minimal LOD`);
}

// The Commander consumes the reviewed mounted source BEFORE its linked LOD, independently
// of ordinary cavalry simplification. Never feed the original torn garment into this branch.
if (!requested.length || requested.includes("viking-commander"))
  await syncVikingCommanderMountedWardrobe({ checkOnly: false });
