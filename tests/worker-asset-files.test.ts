import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

import { sourceFingerprints, type SourceFolders } from "../tools/source-version-plugin";
import { workerAssetFiles } from "../tools/worker-asset-files";
import { workerAssetsPlugin } from "../tools/worker-assets-plugin";

const fixtures: string[] = [];
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "settlers-worker-files-"));
  fixtures.push(root);
  const put = (file: string, value: string | Buffer | object) => {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, typeof value === "object" && !Buffer.isBuffer(value) ? JSON.stringify(value) : value);
  };
  const glb = (json: object) => {
    const text = JSON.stringify(json), payload = Buffer.from(text.padEnd(Math.ceil(text.length / 4) * 4));
    const bytes = Buffer.alloc(20 + payload.length);
    bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4);
    bytes.writeUInt32LE(bytes.length, 8); bytes.writeUInt32LE(payload.length, 12);
    bytes.writeUInt32LE(0x4e4f534a, 16); payload.copy(bytes, 20);
    return bytes;
  };
  for (const folder of ["src", "assets", "worker-src"]) put(`${folder}/original.ts`, "original");
  put("game_ready/tripo/manifest.json", { props: { axe: "props/axe.gltf" }, workers: [{
    model: "body.glb", modelMinimal: "body.glb", neutralBody: "neutral.glb",
    animations: "actions.glb", animationOverrides: "override.glb", sourceBody: "private.glb",
    lods: [{ level: 0, model: "body.glb" }, { level: 1, model: "../character-lods/body/lod1.glb" }]
  }] });
  put("game_ready/tripo/body.glb", glb({ images: [{ uri: "skin%20map.png" }] }));
  for (const file of ["neutral", "actions", "override"]) put(`game_ready/tripo/${file}.glb`, glb({}));
  put("game_ready/tripo/skin map.png", "skin");
  put("game_ready/tripo/props/axe.gltf", { buffers: [{ uri: "axe.bin" }], images: [{ uri: "../skin%20map.png" }] });
  put("game_ready/tripo/props/axe.bin", "axe");
  put("game_ready/armour/manifest.json", { sets: [{ bodies: [{ models: { recruit: "body.glb" },
    modelsMinimal: { recruit: "body.glb" }, layers: { torso: "layer.glb" },
    layersMinimal: { torso: "layer.glb" }, files: { helmet: "helmet.glb" },
    filesMinimal: { helmet: "helmet.glb" }, animations: "../tripo/actions.glb",
    lods: { recruit: [{ level: 1, model: "../character-lods/soldier/recruit-lod1.glb" }] } }] }] });
  put("game_ready/character-lods/body/lod1.glb", glb({ images: [{ uri: "../textures/body-lod.ktx2" }] }));
  put("game_ready/character-lods/soldier/recruit-lod1.glb", glb({}));
  put("game_ready/character-lods/textures/body-lod.ktx2", "lod texture");
  for (const file of ["body", "layer", "helmet"]) put(`game_ready/armour/${file}.glb`, glb({}));
  put("game_ready/mounts/manifest.json", { horse: { model: "horse.glb", coat: { mask: "coat.png" } },
    riders: [{ model: "rider.glb", animations: "rider-actions.glb" }] });
  put("game_ready/mounts/horse.glb", glb({ images: [{ uri: "mane.png" }] }));
  for (const file of ["rider", "rider-actions"]) put(`game_ready/mounts/${file}.glb`, glb({}));
  for (const file of ["coat", "mane"]) put(`game_ready/mounts/${file}.png`, file);
  for (const file of ["basis_transcoder.js", "basis_transcoder.wasm"]) put(`basis/${file}`, file);
  const directories: SourceFolders = { assets: join(root, "assets"), simulation: [join(root, "src")],
    workerAssets: join(root, "game_ready"), workerSource: join(root, "worker-src") };
  return { directories, put, root };
};

afterEach(() => {
  for (const folder of fixtures.splice(0)) rmSync(folder, { force: true, recursive: true });
});

it("hashes authoritative reachable worker resources and canonical source, excluding private pilots", () => {
  const { directories, put } = fixture();
  const original = sourceFingerprints(directories);
  put("game_ready/private-pilot/body.glb", "rejected");
  put("game_ready/tripo/private.glb", "source provenance, not runtime");
  expect(sourceFingerprints(directories)).toEqual(original);
  put("game_ready/tripo/skin map.png", "changed reachable skin");
  const changed = sourceFingerprints(directories);
  expect(changed.sourceVersion).not.toEqual(original.sourceVersion);
  expect(changed.versions.workers).not.toEqual(original.versions.workers);
  expect(changed.versions.simulation).toEqual(original.versions.simulation);
  put("worker-src/original.ts", "canonical source change");
  expect(sourceFingerprints(directories).sourceVersion).not.toEqual(changed.sourceVersion);
});

it("ships exactly the same selected routes, including recursive resources, overrides and mount masks", async () => {
  const { root } = fixture(), folder = join(root, "game_ready");
  const files = workerAssetFiles(folder);
  expect(files).toEqual(expect.arrayContaining(["tripo/override.glb", "tripo/neutral.glb",
    "tripo/skin map.png", "tripo/props/axe.bin", "armour/layer.glb", "armour/helmet.glb",
    "mounts/coat.png", "mounts/mane.png", "mounts/rider-actions.glb", "character-lods/body/lod1.glb",
    "character-lods/soldier/recruit-lod1.glb", "character-lods/textures/body-lod.ktx2"]));
  expect(files.length).toBe(new Set(files).size);
  const emitted: string[] = [];
  const generate = workerAssetsPlugin({ basis: join(root, "basis"), gameReady: folder }).generateBundle;
  if (typeof generate !== "function") throw new Error("Missing worker emission hook");
  await generate.call({ emitFile: ({ fileName }: { fileName: string }) => emitted.push(fileName) } as never,
    {} as never, {} as never, false);
  expect(emitted.sort()).toEqual([...files.map(file => `workers/${file}`),
    "workers/basis/basis_transcoder.js", "workers/basis/basis_transcoder.wasm"].sort());
});

it("rejects linked resource paths that escape the worker root", () => {
  const { put, root } = fixture();
  put("game_ready/tripo/props/axe.gltf", { images: [{ uri: "../../../secret.png" }] });
  expect(() => workerAssetFiles(join(root, "game_ready"))).toThrow("escapes its game_ready root");
});

it("resolves every selected production file without missing external resources", () => {
  const root = resolve(import.meta.dirname, "../../island-of-settlers-worker-generation/game_ready");
  const files = workerAssetFiles(root);
  expect(files).toContain("armour/manifest.json");
  expect(files).toContain("tripo/manifest.json");
  expect(files).toContain("mounts/manifest.json");
  for (const file of files) expect(readFileSync(join(root, file)).length).toBeGreaterThan(0);
});
