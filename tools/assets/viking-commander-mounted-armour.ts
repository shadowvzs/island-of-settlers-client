import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const client = resolve(here, "../..");
const workers = resolve(client, "../island-of-settlers-worker-generation");

/** Reviewed mounted gear is separate from ordinary riders and the standing rank model. */
export const VIKING_COMMANDER_MOUNTED_ARMOUR_SHA =
  "f8a80487cd5a96bad4266a76e10a8807c9f68b8b2ec3bffca45479f291166c3a";
export const VIKING_COMMANDER_MOUNTED_ARMOUR_FILES = Object.freeze({
  canonical: resolve(workers, "game_ready/armour/protected-source/viking-commander-mounted-armour.glb"),
  runtime: resolve(client, "assets/mounts/viking-commander-mounted-armour.glb")
});
const preservedFiles = [
  resolve(workers, "game_ready/mounts/riders/viking-woman-blue/model.glb"),
  resolve(workers, "game_ready/mounts/riders/viking-woman-blue/actions.glb"),
  resolve(workers, "game_ready/armour/manifest.json"),
  ...["recruit", "soldier", "centurion"].map(rank =>
    resolve(workers, `game_ready/armour/viking/viking-woman-blue/body-${rank}.glb`)),
  resolve(client, "assets/mounts/viking-rider-minimal.glb"),
  resolve(client, "assets/mounts/viking-commander-surface.glb")
];
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fingerprints = async () => Promise.all(preservedFiles.map(async file => ({ file, sha256: sha(await readFile(file)) })));

const validate = (bytes: Buffer) => {
  assert.equal(sha(bytes), VIKING_COMMANDER_MOUNTED_ARMOUR_SHA,
    "Only the exact root-reviewed mounted gray payload can be copied");
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  assert(document.images.length === 4 && document.images.every((image: { bufferView?: number; uri?: string }) =>
    !image.uri && Number.isInteger(image.bufferView)), "All original KTX2/WebP image bytes must be embedded");
  assert(document.buffers.every((buffer: { uri?: string }) => !buffer.uri), "Mounted gear cannot depend on external buffers");
  assert(!JSON.stringify(document).includes("/tmp/"), "No private development path can reach runtime");
  const names = document.meshes.map((mesh: { name: string }) => mesh.name);
  for (const slot of ["torso", "waist", "feet"]) for (const lod of [0, 1])
    assert(names.includes(`armour_${slot}_lod${lod}`), "Both reviewed mounted gear detail levels are required");
  return { bytes: bytes.length, embeddedImages: document.images.length,
    sha256: VIKING_COMMANDER_MOUNTED_ARMOUR_SHA };
};

const existing = async (file: string) => readFile(file).catch(error => {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
  throw error;
});

const writeAccepted = async (file: string, bytes: Buffer) => {
  const previous = await existing(file);
  if (previous) {
    assert.equal(sha(previous), VIKING_COMMANDER_MOUNTED_ARMOUR_SHA,
      "Refuse to overwrite a different asset; archive and explicitly review any future revision");
    return;
  }
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, file);
};

/** Read-only publication preparation; this does not mark an asset reviewed or copy anything. */
export const inspectVikingCommanderMountedArmour = async (candidate: string) => ({
  ...validate(await readFile(candidate)),
  files: VIKING_COMMANDER_MOUNTED_ARMOUR_FILES,
  preserved: await fingerprints()
});

/** Default wardrobe regeneration consumes the protected payload, never refits/mutates standing gear. */
export const syncVikingCommanderMountedArmour = async ({ checkOnly }: { checkOnly: boolean }) => {
  const files = VIKING_COMMANDER_MOUNTED_ARMOUR_FILES;
  const source = await readFile(files.canonical), receipt = validate(source);
  if (checkOnly) {
    const runtime = await readFile(files.runtime);
    assert.equal(sha(runtime), receipt.sha256, "Bundled mounted gear must match its protected source exactly");
  } else await writeAccepted(files.runtime, source);
  return { ...receipt, files, mountedOnly: true, standingArmourChanged: false };
};

/** Explicit publication only after root approves the joint gray/blue native result. */
export const publishVikingCommanderMountedArmour = async (candidate: string) => {
  const bytes = await readFile(candidate), receipt = validate(bytes), before = await fingerprints();
  await writeAccepted(VIKING_COMMANDER_MOUNTED_ARMOUR_FILES.canonical, bytes);
  await syncVikingCommanderMountedArmour({ checkOnly: false });
  assert.deepEqual(await fingerprints(), before,
    "Publication must not alter original rider/body/actions, ordinary/standing models or the legacy manifest");
  return { ...receipt, files: VIKING_COMMANDER_MOUNTED_ARMOUR_FILES, preserved: before };
};
