import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { readArmourBody } from "../../../island-of-settlers-worker-generation/src/armour/armour-body";
import { buildSourceKiltPanels } from "../../../island-of-settlers-worker-generation/src/national-workers/source-kilt-panels";
import { createSourceKiltWaist } from "../../../island-of-settlers-worker-generation/src/national-workers/source-kilt-waist";
import { createRetargetIO } from "../../../island-of-settlers-worker-generation/src/retarget/retarget-context";

const output = resolve("../resources/project-reviews/armour-shared-repair-2026-11-02");
const sourcePath = resolve("../island-of-settlers-worker-generation/game_ready/original-clothes-review/nubian-man-scarf/model.glb");
const io = await createRetargetIO(), reference = readArmourBody(await io.read(sourcePath));
const support = buildSourceKiltPanels(await io.read(sourcePath), "nubian-man-scarf");
const field = createSourceKiltWaist(reference, support), hips = reference.joints.get("Hips")!;
const prior = JSON.parse(await readFile(resolve(output, "source-kilt-original-skin-fit-d.json"), "utf8"));
const records = [6522, 1501, 10775, 10766, 3874, 6656, 6655].map(vertex => {
  assert(support.ownedVertices.includes(vertex) && !support.originalLegVertices.includes(vertex));
  const current = prior.fittedProfile.weights.find((group: { vertices: number[] }) => group.vertices.includes(vertex));
  const raw = [...field.weightsAt(reference.points[vertex]!, reference.points[vertex]!.x >= hips.x ? 1 : -1)]
    .filter(([, weight]) => weight > 1e-8).map(([joint, weight]) => ({ joint,
      name: reference.skeleton.names[reference.surface.jointNodes[joint]!]!, weight }));
  return { vertex, point: reference.points[vertex]!.toArray(), current,
    closestOriginalBodyWeights: raw, missingCurrentJoints: raw.filter(value => !current.joints.includes(value.joint)) };
});
await writeFile(resolve(output, "source-cloth-original-body-field-audit.json"), JSON.stringify({ records,
  scope: "Read-only barycentric weights on the actual original own-side pelvis/leg facets. No geometry fit/inflation or source mutation." }, null, 2));
console.log(JSON.stringify(records, null, 2));
