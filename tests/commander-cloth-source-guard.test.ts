import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { NodeIO } from "../../island-of-settlers-worker-generation/node_modules/@gltf-transform/core/dist/index.js";
import { ALL_EXTENSIONS } from "../../island-of-settlers-worker-generation/node_modules/@gltf-transform/extensions/dist/index.js";
import { MeshoptDecoder, MeshoptEncoder } from "../../island-of-settlers-worker-generation/node_modules/meshoptimizer/index.js";
import { guardCommanderClothSource, VIKING_CLOTH_SOURCE_SHA, VIKING_CLOTH_STAGE_SHA, type VikingClothProfile } from "../tools/assets/commander-cloth-source-guard";

it.each(["exact-narrow-mask", "reject-body-skin", "reject-cloth-rest"])("guards the staged Commander cloth: %s", async mode => {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder
  });
  const stage = resolve("../resources/project-reviews/commander-possession-2026-11-03/viking-cloth-spine-approved-a");
  const source = resolve("../island-of-settlers-worker-generation/game_ready/mounts/riders/viking-woman-blue/model.glb");
  const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  expect(hash(source)).toBe(VIKING_CLOTH_SOURCE_SHA); expect(hash(resolve(stage, "model.glb"))).toBe(VIKING_CLOTH_STAGE_SHA);
  const original = await io.read(source), candidate = await io.read(resolve(stage, "model.glb"));
  const profile = JSON.parse(readFileSync(resolve(stage, "profile.json"), "utf8")) as VikingClothProfile;
  if (mode !== "exact-narrow-mask") {
    const primitives = candidate.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
    const attribute = mode === "reject-body-skin" ? primitives[0]!.getAttribute("WEIGHTS_0")! : primitives[1]!.getAttribute("POSITION")!;
    const values = attribute.getElement(0, Array(attribute.getElementSize()).fill(0)); values[0]! += .05;
    attribute.setElement(0, values);
    await expect(guardCommanderClothSource(io, original, candidate, profile)).rejects.toThrow(/Unchanged/);
  } else expect((await guardCommanderClothSource(io, original, candidate, profile)).size).toBeGreaterThan(0);
});
