import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SkinnedMesh } from "three";

import { readCpuGltf } from "../assets/read-cpu-gltf";

const review = resolve("../resources/project-reviews/commander-possession-2026-11-03/viking-cloth-native-a");
const mask = JSON.parse(readFileSync(resolve(review, "approved-bilateral-mask.json"), "utf8"));
const source = await readCpuGltf(mask.source);
const meshes: SkinnedMesh[] = [];
source.scene.traverse(node => { if ((node as SkinnedMesh).isSkinnedMesh) meshes.push(node as SkinnedMesh); });
const cloth = meshes.find(mesh => source.parser.associations.get(mesh)?.primitives === mask.originalPrimitive)!;
const joints = cloth.geometry.getAttribute("skinIndex"), weights = cloth.geometry.getAttribute("skinWeight");
const counts = new Map<string, number>();
const vertices = mask.vertices.map((vertex: number) => {
  const bindings = Array.from({ length: 4 }, (_, slot) => ({
    name: cloth.skeleton.bones[joints.getComponent(vertex, slot)]!.name,
    weight: weights.getComponent(vertex, slot),
  })).filter(binding => binding.weight > .000001);
  const key = bindings.map(binding => binding.name).sort().join("/");
  counts.set(key, (counts.get(key) ?? 0) + 1);
  return { bindings, vertex };
});
const output = { source: mask.source, groups: Object.fromEntries(counts), vertices };
writeFileSync(resolve(review, "original-four-bone-support-audit.json"), JSON.stringify(output, null, 2));
console.log(JSON.stringify({ groups: output.groups, vertices: vertices.length }));
