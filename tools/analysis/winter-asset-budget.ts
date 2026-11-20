import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";

import { getWinterFoliageAtlas } from "../../src/render-common/seasonal-appearance/winter-foliage";
import { getWinterPropMesh } from "../../src/render-common/seasonal-appearance/winter-props";
import { createFoliageAtlas } from "../../src/render-common/trees/foliage-atlas";

const output = resolve("../resources/project-reviews/winter-assets-2026-11-02");
mkdirSync(output, { recursive: true });
// Match Vite's existing GLB ?url&inline imports in this CPU-only Node audit.
registerHooks({ load: (url, context, next) => {
  if (!new URL(url).pathname.endsWith(".glb")) return next(url, context);
  const data = `data:model/gltf-binary;base64,${readFileSync(new URL(url)).toString("base64")}`;
  return { format: "module", shortCircuit: true, source: `export default ${JSON.stringify(data)};` };
} });
const { createPropMeshes, getMeshKind } = await import("../../src/render-common/props/prop-meshes");
const { getSeasonalPropKind } = await import("../../src/renderers/three/three-seasonal-content");
const hash = (array: ArrayBufferView) => createHash("sha256")
  .update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)).digest("hex");
const source = createPropMeshes(2024), reports: unknown[] = [];
const started = performance.now();
for (const [mesh, original] of source.entries()) {
  const before = { color: hash(original.colors), indices: hash(original.indices) };
  const kind = getSeasonalPropKind(getMeshKind(mesh));
  const winter = kind ? getWinterPropMesh(original, kind) : original;
  if (kind) assert.equal(getWinterPropMesh(original, kind), winter);
  else assert.equal(winter, original);
  for (const key of ["positions", "normals", "uvs", "wind"] as const) assert.equal(winter[key], original[key]);
  assert.equal(hash(original.colors), before.color); assert.equal(hash(original.indices), before.indices);
  assert.equal(winter.height, original.height); assert.equal(winter.radius, original.radius);
  assert(winter.indices.length <= original.indices.length && winter.indices.length % 3 === 0);
  assert((winter.coreIndexCount ?? 0) <= (original.coreIndexCount ?? 0));
  assert((winter.minimalIndices?.length ?? 0) <= (original.minimalIndices?.length ?? 0));
  assert([...winter.indices, ...winter.minimalIndices ?? []].every(index => index < original.positions.length / 3));
  assert([...winter.colors].every(value => Number.isFinite(value)));
  if (kind) assert([...winter.colors].every(value => value >= 0 && value <= 1));
  reports.push({ mesh, kind: kind ?? "unchanged", vertices: original.positions.length / 3, originalIndices: original.indices.length,
    winterIndices: winter.indices.length, originalCoreIndices: original.coreIndexCount,
    winterCoreIndices: winter.coreIndexCount, originalMinimalIndices: original.minimalIndices?.length,
    winterMinimalIndices: winter.minimalIndices?.length });
}
const meshTransformMs = performance.now() - started;
const atlas = createFoliageAtlas(7), originalHash = hash(atlas.color), atlasStarted = performance.now();
const winter = getWinterFoliageAtlas(atlas), atlasTransformMs = performance.now() - atlasStarted;
assert.equal(getWinterFoliageAtlas(atlas), winter); assert.equal(hash(atlas.color), originalHash);
assert.equal(winter.normal, atlas.normal); assert.equal(winter.normalMips, atlas.normalMips);
for (const [level, mip] of atlas.colorMips!.entries()) {
  const seasonal = winter.colorMips![level]!;
  assert.deepEqual([seasonal.width, seasonal.height, seasonal.data.byteLength], [mip.width, mip.height, mip.data.byteLength]);
  for (let alpha = 3; alpha < mip.data.length; alpha += 4) assert.equal(seasonal.data[alpha], mip.data[alpha]);
}
const receipt = { meshSeed: 2024, foliageSeed: 7, meshCount: source.length, meshTransformMs, atlasTransformMs,
  atlas: { width: winter.width, height: winter.height, colorBytes: winter.color.byteLength,
    normalBytes: winter.normal.byteLength, colorMipBytes: winter.colorMips!.map(mip => mip.data.byteLength),
    normalMipBytes: winter.normalMips!.map(mip => mip.data.byteLength) }, reports,
  limit: "Pure CPU contract audit. Renderer toggles, seasonal appearance and bakes require separate native acceptance." };
writeFileSync(resolve(output, "asset-budget.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ ...receipt, reports: `${reports.length} canonical meshes validated` }, null, 2));
