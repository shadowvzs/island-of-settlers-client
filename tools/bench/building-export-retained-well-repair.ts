import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { repairRetainedWellAnimationChannels } from "./building-export-retained-well";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "building-assets-sync-2026-11-04", "full-b");
const apply = process.argv.includes("--apply"), backup = resolve(output, "pre-hidden-well-anchor-r4");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const jsonOf = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes.subarray(20,
  20 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true))));
const tailOf = (bytes: Uint8Array) => bytes.subarray(20 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true));
const changes: { path: string; before: Uint8Array; after: Uint8Array }[] = [];
const proofs: unknown[] = [];
for (const nation of ["roman", "viking", "nubian", "japanese"]) {
  const statsPath = `assets/buildings/${nation}/export-stats.json`, beforeStats = readFileSync(statsPath);
  const stats = JSON.parse(beforeStats.toString("utf8"));
  for (const quality of ["high", "minimal"]) {
    const path = `assets/buildings/${nation}/${nation}-library-${quality}.glb`, before = readFileSync(path);
    const repaired = repairRetainedWellAnimationChannels(before, nation), old = jsonOf(before), next = jsonOf(repaired.bytes);
    assert.equal(repaired.repaired, 2);
    assert(Buffer.from(tailOf(before)).equals(tailOf(repaired.bytes)),
      "Every original BIN/image/animation sample byte must survive");
    for (const key of ["meshes", "materials", "textures", "images", "accessors", "bufferViews", "buffers", "samplers"])
      assert.deepEqual(next[key], old[key], `Static glTF section changed: ${key}`);
    assert.equal(next.nodes.length, old.nodes.length + 1);
    for (let at = 0; at < old.nodes.length; at++) {
      const normalized = structuredClone(next.nodes[at]);
      if (normalized.name === `${nation}_35`) normalized.children = normalized.children.slice(0, -1);
      assert.deepEqual(normalized, old.nodes[at], "Existing node geometry/transform/identity changed");
    }
    const normalizedAnimations = structuredClone(next.animations);
    for (const animation of normalizedAnimations) for (const channel of animation.channels)
      if (channel.target.node === old.nodes.length) delete channel.target.node;
    assert.deepEqual(normalizedAnimations, old.animations, "Clip names/times/counts/samples changed");
    for (const animation of next.animations) for (const channel of animation.channels)
      assert(Number.isInteger(channel.target.node) && next.nodes[channel.target.node], "Unbound channel remains");
    changes.push({ path, before, after: repaired.bytes });
    stats.libraries.find((library: { quality: string }) => library.quality === quality).bytes = repaired.bytes.length;
    proofs.push({ nation, quality, path, beforeSha256: sha(before), afterSha256: sha(repaired.bytes),
      binaryPayloadSha256: sha(tailOf(before)), binaryPayloadIdentical: true, staticSectionsIdentical: true,
      originalNodesIdentical: true, animationSamplesIdentical: true, clipCount: next.animations.length,
      repairedChannels: repaired.changes, allChannelsBound: true });
  }
  stats.exportInteroperabilityRepair = { kind: "hidden-Well35-empty-animation-anchor",
    receipt: "retained-well-repair-receipt.json", geometryImagesAndAnimationSamplesUnchanged: true };
  changes.push({ path: statsPath, before: beforeStats, after: new TextEncoder().encode(JSON.stringify(stats, null, 2) + "\n") });
}
const receipt = { preparedAt: new Date().toISOString(), applied: apply, nativeExecuted: false,
  policy: "Eight GLB JSON-only Well35 anchor repairs; original full BIN chunks/static sections/animation samples identical. Existing PNG previews/icons untouched. All prior hashes remain historical in retained stage proofs and backups.", proofs };
writeFileSync(resolve(output, "retained-well-repair-plan.json"), JSON.stringify(receipt, null, 2));
if (apply) {
  assert(!existsSync(backup), "Preserve the original pre-anchor production bytes");
  for (const row of changes) {
    const destination = resolve(backup, row.path); mkdirSync(resolve(destination, ".."), { recursive: true });
    copyFileSync(row.path, destination); assert.equal(sha(readFileSync(destination)), sha(row.before));
  }
  for (const row of changes) writeFileSync(row.path, row.after);
  writeFileSync(resolve(output, "retained-well-repair-receipt.json"), JSON.stringify(receipt, null, 2));
}
console.log(JSON.stringify({ applied: apply, libraries: proofs.length, files: changes.length,
  binaryPayloadsIdentical: true, allChannelsBound: true, backup: apply ? backup : null }));
