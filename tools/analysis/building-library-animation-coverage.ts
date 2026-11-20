import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { BUILDING_CATALOG } from "../../src/render-common/buildings/building-catalog";
import { resourcesPath } from "../bench/resources-path";

const results = [];
for (const nation of ["roman", "viking", "nubian", "japanese", "indigenous", "chinese", "persian", "maya"])
  for (const quality of ["high", "minimal"]) {
    const path = `assets/buildings/${nation}/${nation}-library-${quality}.glb`, bytes = readFileSync(path);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"));
    const names = new Set(json.animations.map((clip: { name: string }) => clip.name));
    assert.equal(names.size, json.animations.length, `${path}: duplicate clip name`);
    for (const definition of BUILDING_CATALOG) if (definition.id !== 7)
      for (const name of ["construction", "door", "working"])
        assert(names.has(`${nation}_${definition.id}_${name}`), `${path}: missing native clip`);
    let channels = 0;
    for (const clip of json.animations) {
      assert(clip.channels.length, `${path}: empty ${clip.name}`);
      for (const channel of clip.channels) {
        assert(Number.isInteger(channel.target.node) && json.nodes[channel.target.node],
          `${path}: unbound ${clip.name} channel`);
        const sampler = clip.samplers[channel.sampler];
        assert(sampler && json.accessors[sampler.input] && json.accessors[sampler.output], `${path}: missing sampler`);
        assert(["translation", "rotation", "scale", "weights"].includes(channel.target.path), `${path}: unsupported path`);
        if (channel.target.path === "weights") {
          const mesh = json.meshes[json.nodes[channel.target.node].mesh];
          assert(mesh?.primitives.some((primitive: { targets?: unknown[] }) => primitive.targets?.length),
            `${path}: weights channel has no morph geometry`);
        }
        channels++;
      }
    }
    results.push({ nation, quality, path, clips: json.animations.length, channels, allTargetsBound: true });
  }
writeFileSync(resolve(resourcesPath("project-reviews", "building-assets-sync-2026-11-04", "full-b"),
  "building-animation-channel-coverage.json"), JSON.stringify({ passed: true, libraries: results.length,
    results, policy: "Every channel in all16actual GLBs targets an existing node; no empty/required clip removed." }, null, 2));
console.log(`All${results.length} national GLB libraries retain required clips with every animation channel bound.`);
