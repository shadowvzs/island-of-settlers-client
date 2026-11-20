import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../resources/models");
const entries = [
  { category: "plant/crop", path: "plants/crops/wheat.glb", status: "Reference; not integrated",
    note: "Eight textured triangles; evaluate alpha-card appearance before replacing procedural wheat." },
  { category: "animal/livestock", path: "animals/livestock/lowpoly_pig.glb", status: "Integrated pig-farm source",
    note: "Source has no rig. Shared textured High/Minimal derivatives use a derived anatomical rig; feeding, growth and all four farm rotations are verified." },
  { category: "terrain/mountain", path: "rocks/mountains/mountain_glacier.glb", status: "Reference only",
    note: "Embedded licence is non-commercial (CC-BY-NC-4.0); do not include in distributed game assets." }
];

const catalogue = entries.map(entry => {
  const path = resolve(root, entry.path);
  const source = existsSync(path) ? path : resolve(root, entry.path.split("/").at(-1)!);
  const bytes = readFileSync(source);
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2)
    throw new Error(`Expected GLB v2: ${source}`);
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`Missing JSON chunk: ${source}`);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  let triangles = 0;
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      if ((primitive.mode ?? 4) !== 4) continue;
      const index = primitive.indices ?? primitive.attributes.POSITION;
      triangles += gltf.accessors[index].count / 3;
    }
  }
  return { ...entry, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    provenance: gltf.asset.extras ?? {}, generator: gltf.asset.generator ?? null,
    triangles, meshes: gltf.meshes?.length ?? 0, materials: gltf.materials?.length ?? 0,
    embeddedImages: gltf.images?.length ?? 0, imageTypes: (gltf.images ?? []).map((image: any) => image.mimeType),
    skins: gltf.skins?.length ?? 0, animations: (gltf.animations ?? []).map((animation: any) => animation.name ?? null),
    requiredExtensions: gltf.extensionsRequired ?? [],
    provenanceEvidence: "Embedded GLB asset.extras; source files preserved unchanged." };
});
writeFileSync(resolve(root, "loose-models-catalog.json"), JSON.stringify({
  date: "2026-10-11", scope: "Three formerly loose models at resources/models root", models: catalogue
}, null, 2) + "\n");
const lines = ["# Formerly loose source models", "",
  "Organized on 2026-10-11. Originals are preserved byte-for-byte. Licence and author information",
  "below comes from embedded GLB metadata; derived game assets carry their own changes/credits.", "",
  "| File | Category | Author | Embedded licence | Triangles | Images | Rig / clips | Use |",
  "| --- | --- | --- | --- | ---: | ---: | --- | --- |"];
for (const model of catalogue) {
  lines.push(`| [${model.path}](${model.path}) | ${model.category} | ${model.provenance.author ?? "Unknown"} | ` +
    `${model.provenance.license ?? "Unknown"} | ${model.triangles.toLocaleString("en-US")} | ` +
    `${model.embeddedImages} | ${model.skins} / ${model.animations.length} | ${model.status} |`);
}
lines.push("", ...catalogue.flatMap(model => [`- **${model.provenance.title}:** ${model.note}`]), "",
  "Machine-readable details and source SHA-256 hashes: [loose-models-catalog.json](loose-models-catalog.json).", "");
writeFileSync(resolve(root, "LOOSE-MODELS.md"), lines.join("\n"));
console.log(`Catalogued ${catalogue.length} source models.`);
