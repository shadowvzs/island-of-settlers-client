import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createRetargetIO } from "../../../island-of-settlers-worker-generation/src/retarget/retarget-context";
import { publishVikingCommanderMountedArmour, syncVikingCommanderMountedArmour } from "./viking-commander-mounted-armour";

const client = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workers = resolve(client, "../island-of-settlers-worker-generation");
const canonical = resolve(workers, "game_ready/mounts/protected-source");
const original = resolve(workers, "game_ready/mounts/riders/viking-woman-blue/model.glb");
const sourceSHA = "a3ff0a7e7bbdbbf4be338d29a0764508f3d702ab3a17822868cd8d4962fc6907";
const pair = [
  { quality: "high", sha: "ee18370ef134697526499ef6c85620dbf001f58a51e13dbbfc12be152884ebb7", triangles: 10261,
    geometryBytes: 365459, file: "viking-commander-mounted-clean.glb" },
  { quality: "minimal", sha: "a99513d021090754d80bd7f67d5089b567aa0e2106e8a1068d5ed1e2bb706d47", triangles: 8440,
    geometryBytes: 412222, file: "viking-commander-mounted-clean-minimal.glb" }
] as const;
const policyFile = resolve(canonical, "viking-commander-clean-policy.json");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const canonicalFile = (quality: string) => resolve(canonical, `viking-commander-clean-${quality}.glb`);
const preserved = [original, resolve(workers, "game_ready/tripo/viking-woman-blue/model.glb"),
  resolve(client, "assets/mounts/viking-rider-minimal.glb"), resolve(client, "assets/mounts/viking-commander-surface.glb")];
const fingerprints = () => Promise.all(preserved.map(async file => ({ file, sha256: sha(await readFile(file)) })));
const save = async (file: string, bytes: Buffer) => {
  const old = await readFile(file).catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  if (old) { assert(old.equals(bytes), `Refuse to replace a different reviewed asset: ${file}`); return; }
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, file);
};

interface Policy {
  sourceSha256: string;
  rootAccepted: boolean;
  removedAllProvenClothBodyFaces: number[];
  artifacts: { quality: string; bodySourceVertices: number[] }[];
}

/** The exact reviewed High source is checked BEFORE its linked Commander-only Minimal derivative. */
const validatePair = async (files: string[], policy: Policy) => {
  assert.equal(policy.sourceSha256, sourceSHA);
  assert.equal(sha(await readFile(original)), sourceSHA, "Original anatomy/standing rollback must be retained");
  const io = await createRetargetIO(), source = await io.read(original);
  const sourceParts = source.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
  const sourceSkin = source.getRoot().listSkins()[0]!;
  const sourceNodes = source.getRoot().listNodes().map(node => ({ name: node.getName(), matrix: node.getMatrix(),
    children: node.listChildren().map(child => child.getName()) }));
  const receipts = [];
  for (const [index, item] of pair.entries()) {
    const bytes = await readFile(files[index]!);
    assert.equal(sha(bytes), item.sha, `Only the native-reviewed ${item.quality} source is eligible`);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    assert(json.images.every((image: { uri?: string; bufferView?: number }) => !image.uri && Number.isInteger(image.bufferView)));
    assert(json.buffers.every((buffer: { uri?: string }) => !buffer.uri), "No external/private buffer dependencies");
    const document = await io.read(files[index]!);
    const parts = document.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
    assert.equal(parts.length, 2, "Keep the original two material draws without overlays");
    assert(parts.every(part => part.listTargets().length === 0), "No corrective runtime driver is required");
    const triangles = parts.reduce((sum, part) => sum + part.getIndices()!.getCount() / 3, 0);
    const geometryBytes = document.getRoot().listAccessors().reduce((sum, accessor) => sum + accessor.getArray()!.byteLength, 0);
    assert.equal(triangles, item.triangles); assert.equal(geometryBytes, item.geometryBytes);
    if (item.quality === "minimal") { assert(triangles <= 8500); assert(geometryBytes <= 614400); }
    assert.deepEqual(document.getRoot().listNodes().map(node => ({ name: node.getName(), matrix: node.getMatrix(),
      children: node.listChildren().map(child => child.getName()) })), sourceNodes, "Original body hierarchy and transforms");
    const skin = document.getRoot().listSkins()[0]!;
    assert.deepEqual(skin.listJoints().map(joint => joint.getName()), sourceSkin.listJoints().map(joint => joint.getName()));
    assert.deepEqual(skin.getInverseBindMatrices()!.getArray(), sourceSkin.getInverseBindMatrices()!.getArray());
    assert.equal(sha(parts[0]!.getMaterial()!.getBaseColorTexture()!.getImage()!),
      sha(sourceParts[0]!.getMaterial()!.getBaseColorTexture()!.getImage()!), "Original anatomy texture");
    if (item.quality === "high") {
      for (const semantic of sourceParts[0]!.listSemantics())
        assert.deepEqual(parts[0]!.getAttribute(semantic)!.getArray(), sourceParts[0]!.getAttribute(semantic)!.getArray(),
          `Original anatomy ${semantic} must be byte-exact`);
      const removed = new Set(policy.removedAllProvenClothBodyFaces);
      const indices = Array.from(sourceParts[0]!.getIndices()!.getArray()!);
      assert.deepEqual(Array.from(parts[0]!.getIndices()!.getArray()!),
        indices.filter((_, at) => !removed.has(Math.floor(at / 3))), "Only declared old garment facets are replaced");
    } else {
      const mapping = policy.artifacts.find(artifact => artifact.quality === "minimal")!.bodySourceVertices;
      assert.equal(mapping.length, parts[0]!.getAttribute("POSITION")!.getCount());
      for (const semantic of sourceParts[0]!.listSemantics()) {
        const input = sourceParts[0]!.getAttribute(semantic)!, output = parts[0]!.getAttribute(semantic)!;
        for (const [vertex, sourceVertex] of mapping.entries()) {
          const a = input.getElement(sourceVertex, []), b = output.getElement(vertex, []);
          assert(a.every((value, channel) => Math.abs(value - b[channel]!) <= 1e-6), `Minimal retains source anatomy ${semantic}`);
        }
      }
    }
    receipts.push({ quality: item.quality, sha256: item.sha, triangles, geometryBytes, bytes: bytes.length });
  }
  return receipts;
};

/** Future exports consume the accepted protected source pair, never the legacy cloth fitter. */
export const syncVikingCommanderMountedWardrobe = async ({ checkOnly }: { checkOnly: boolean }) => {
  const policy: Policy = JSON.parse(await readFile(policyFile, "utf8"));
  assert(policy.rootAccepted, "Publication requires the recorded root visual acceptance");
  const before = await fingerprints();
  const receipt = await validatePair(pair.map(item => canonicalFile(item.quality)), policy);
  for (const item of pair) {
    const output = resolve(client, "assets/mounts", item.file), bytes = await readFile(canonicalFile(item.quality));
    if (checkOnly) assert.equal(sha(await readFile(output)), item.sha);
    else await save(output, bytes);
  }
  const armour = await syncVikingCommanderMountedArmour({ checkOnly });
  assert.deepEqual(await fingerprints(), before);
  return { body: receipt, armour, commanderOnly: true, ordinaryAndStandingUnchanged: true };
};

/** Read-only preparation verifies the real source geometry before any publication. */
export const inspectVikingCommanderMountedWardrobe = async (review: string) => {
  const policy: Policy = JSON.parse(await readFile(resolve(review, "provenance.json"), "utf8"));
  return validatePair(pair.map(item => resolve(review, `model-${item.quality}.glb`)), policy);
};

/** Explicit one-time publication accepts only the frozen native-reviewed pair and gray C payload. */
export const publishVikingCommanderMountedWardrobe = async (review: string, armour: string) => {
  const provenance = JSON.parse(await readFile(resolve(review, "provenance.json"), "utf8"));
  const policy = { ...provenance, rootAccepted: true, productionPublished: true,
    rootAcceptance: "Root independently accepts D clean mounted hem and gray C mail/belt; Commander-only publication.",
    artifacts: provenance.artifacts.map(({ file: _file, ...artifact }: { file: string }) => artifact) };
  const files = pair.map(item => resolve(review, `model-${item.quality}.glb`));
  await validatePair(files, policy);
  for (const [index, item] of pair.entries()) await save(canonicalFile(item.quality), await readFile(files[index]!));
  await save(policyFile, Buffer.from(JSON.stringify(policy, null, 2) + "\n"));
  await publishVikingCommanderMountedArmour(armour);
  return syncVikingCommanderMountedWardrobe({ checkOnly: false });
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const publish = process.argv.indexOf("--publish-reviewed");
  const inspect = process.argv.indexOf("--inspect-reviewed");
  let result;
  if (inspect >= 0) result = await inspectVikingCommanderMountedWardrobe(resolve(process.argv[inspect + 1]!));
  else if (publish >= 0)
    result = await publishVikingCommanderMountedWardrobe(resolve(process.argv[publish + 1]!), resolve(process.argv[publish + 2]!));
  else result = await syncVikingCommanderMountedWardrobe({ checkOnly: process.argv.includes("--check") });
  console.log(JSON.stringify(result, null, 2));
}
