import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Vector3 } from "three";

import type { DonorRayConstraint, DonorRayCorner } from "./source-cloth-donor-ray-fit";
import { solveHardClothContacts } from "./source-cloth-hard-contacts";
import { type ClothMotionCell, createHardClothState } from "./source-cloth-hard-state";

interface RawVector { x: number; y: number; z: number }
interface RawCorner { base: RawVector; basis?: RawVector[]; delta: RawVector; group: number }
type RawConstraint = Omit<DonorRayConstraint, "alternatives" | "corners" | "direction" | "origin"> & {
  alternatives?: RawCorner[][]; corners: RawCorner[]; direction: RawVector; origin: RawVector;
};
type RawMotion = Omit<ClothMotionCell, "basis" | "original"> & { basis: RawVector[]; original: RawVector };

const inputFile = "/tmp/viking-hard-contact-input.json";
const outputFile = "/tmp/viking-hard-contact-control-a.json";
assert(!existsSync(outputFile), "Preserve every bounded feasibility receipt; do not overwrite a previous control");
const bytes = readFileSync(inputFile), input = JSON.parse(bytes.toString()) as {
  constraints: RawConstraint[]; groupOf: Array<[number, number]>;
  groupSeeds: Array<{ joints: number[]; values: number[]; vertex: number }>;
  motion: RawMotion[]; sourceSha256: string;
};
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const sourceFile = resolve("../island-of-settlers-worker-generation/game_ready/mounts/riders/viking-woman-blue/model.glb");
assert.equal(input.sourceSha256, "a3ff0a7e7bbdbbf4be338d29a0764508f3d702ab3a17822868cd8d4962fc6907");
assert.equal(hash(readFileSync(sourceFile)), input.sourceSha256);
const approved = JSON.parse(readFileSync(resolve(
  "../resources/project-reviews/commander-possession-2026-11-03/viking-cloth-native-a/approved-bilateral-restored-mask.json"), "utf8"));
assert.deepEqual(input.groupOf.map(([vertex]) => vertex).sort((a, b) => a - b), approved.vertices);
assert.equal(input.groupSeeds.length, 71);
assert.equal(input.motion.length, 137 * 60);
assert.equal(input.constraints.filter(constraint => constraint.target).length, 8);
assert(input.groupSeeds.every(record => record.joints.length === 4 && record.values.length === 4));
const vector = (value: RawVector) => new Vector3(value.x, value.y, value.z);
const corner = (value: RawCorner): DonorRayCorner => ({ ...value, base: vector(value.base),
  basis: value.basis?.map(vector), delta: vector(value.delta) });
const constraints = input.constraints.map(value => ({ ...value,
  alternatives: value.alternatives?.map(face => face.map(corner)), corners: value.corners.map(corner),
  direction: vector(value.direction), origin: vector(value.origin),
}));
const motion = input.motion.map(value => ({ ...value, basis: value.basis.map(vector), original: vector(value.original) }));
for (const cell of motion) assert.equal(cell.maximumMotion, [137, 151].includes(cell.vertex) ? .060 : .065);
const base = input.groupSeeds.flatMap(record => record.values);
const state = createHardClothState(base, base, motion);
const result = solveHardClothContacts(state, constraints, 40, report => {
  const value = report as { pass: number; targetFailures: number; preservationFailures: number; maximumDistance: number };
  console.log(JSON.stringify({ pass: value.pass, targetFailures: value.targetFailures,
    preservationFailures: value.preservationFailures, maximumDistance: value.maximumDistance }));
});
assert.equal(hash(readFileSync(sourceFile)), input.sourceSha256);
const profile = input.groupOf.map(([vertex, group]) => ({ vertex,
  joints: input.groupSeeds[group]!.joints, values: result.weights.slice(group * 4, group * 4 + 4),
}));
writeFileSync(outputFile, JSON.stringify({ method: "Sequential hard ray-contact projection with exact integer-simplex storage and direct per-pose motion balls",
  sourceSha256: input.sourceSha256, inputSha256: hash(bytes), sourceUnchanged: true, newGLBWritten: false,
  published: false, nativeAccepted: false, actualWholeSourceVisibilityReplayed: false,
  seed: "Exact quantized original-source weights on the explicit frozen joint supports; no scalar donor blend",
  localFailureIsNotGlobalInfeasibility: true, profile, ...result }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ outputFile, reason: result.reason, allHardContactsSatisfied: result.allHardContactsSatisfied,
  targetFailures: result.targetFailures, preservationFailures: result.preservationFailures, motion: result.motion }));
