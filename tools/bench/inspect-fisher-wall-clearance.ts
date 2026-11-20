import { readFileSync } from "node:fs";
import { Matrix4, Vector3 } from "three";

import { FISHING_SKIFF_BEAM, FISHING_SKIFF_LENGTH } from "../../src/render-common/ships/fishing-skiff-dimensions";
import { LIGHTER_BEAM, LIGHTER_LENGTH } from "../../src/render-common/ships/lighter-dimensions";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import { buildNationalShuttleHull } from "../../src/renderers/three/settlement/national-harbour-boat";
const nation = process.argv[2] ?? "roman", variant = process.argv[3] ?? "roman-man-grey";
const report = JSON.parse(readFileSync(`/tmp/codex-fisher-boat/dense-probe/yard/arms/${variant}-runtime-review.json`, "utf8"));
const geometry = buildNationalShuttleHull(nation as any, true);
geometry.scale(FISHING_SKIFF_BEAM / LIGHTER_BEAM / WORKER_SCALE, .78 / WORKER_SCALE, FISHING_SKIFF_LENGTH / LIGHTER_LENGTH / WORKER_SCALE);
geometry.translate(0, -.234 / WORKER_SCALE, 0);
const positions = geometry.attributes.position!;
console.log(JSON.stringify(report.captures.filter((c: any) => c.hullMatrix).map((c: any, index: number) => {
 const matrix = new Matrix4().fromArray(c.hullMatrix); let gap = Infinity;
 for (let at = 0; at < positions.count; at++) gap = Math.min(gap, .725 - new Vector3().fromBufferAttribute(positions, at).applyMatrix4(matrix).x);
 return { index, gap };
}).filter((p: any) => p.gap < 0)));
