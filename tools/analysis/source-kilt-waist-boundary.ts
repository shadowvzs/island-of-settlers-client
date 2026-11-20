import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { readArmourBody } from "../../../island-of-settlers-worker-generation/src/armour/armour-body";
import { buildSourceKiltPanels } from "../../../island-of-settlers-worker-generation/src/national-workers/source-kilt-panels";
import { readSourceKiltWaistSeam } from "../../../island-of-settlers-worker-generation/src/national-workers/source-kilt-seam";
import { createRetargetIO } from "../../../island-of-settlers-worker-generation/src/retarget/retarget-context";

const { values } = parseArgs({ options: { out: { type: "string" } } });
assert(values.out, "Choose an explicit original-waist topology receipt");
const path = resolve("../island-of-settlers-worker-generation/game_ready/original-clothes-review/nubian-man-scarf/model.glb");
const sha = async () => createHash("sha256").update(await readFile(path)).digest("hex");
const inputSha256 = await sha(), io = await createRetargetIO(), document = await io.read(path);
const support = buildSourceKiltPanels(document, "nubian-man-scarf"), body = readArmourBody(document);
const waist = support.weightField.waist;
const seam = readSourceKiltWaistSeam(body, support), points = seam.map(vertex => vertex.point.toArray());
const loops = [{ vertices: seam.length, closed: true,
  bounds: [0, 1, 2].map(axis => [Math.min(...points.map(point => point[axis]!)),
    Math.max(...points.map(point => point[axis]!))]),
  originalVertices: seam.map(vertex => vertex.source), points }];
assert.equal(await sha(), inputSha256);
const receipt = { inputSha256, originalUnchanged: true, waist,
  scope: "Literal original upper-shirt cut boundary; in-memory analysis only, no asset or source geometry write",
  edges: seam.length, vertices: seam.length, degreeHistogram: { 2: seam.length }, loops };
await writeFile(values.out, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ ...receipt, loops: loops.map(({ points: _points, originalVertices: _vertices, ...loop }) => loop) }));
