import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";

import { workerAssetsPlugin } from "../tools/worker-assets-plugin";

const glb = (uri?: string) => {
  const json = JSON.stringify({ asset: { version: "2.0" }, images: uri ? [{ uri }] : [] });
  const padded = json.padEnd(Math.ceil(json.length / 4) * 4, " ");
  const bytes = Buffer.alloc(20 + padded.length);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(padded.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); bytes.write(padded, 20);
  return bytes;
};

it("ships shared base once plus all rank/detail layers and their external textures", async () => {
  const folder = mkdtempSync(join(tmpdir(), "military-layer-assets-"));
  const put = (path: string, value: string | Buffer) => {
    const file = join(folder, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, value);
  };
  try {
    put("tripo/manifest.json", JSON.stringify({ props: {}, workers: [] }));
    put("armour/manifest.json", JSON.stringify({ sets: [{ bodies: [{
      files: {}, models: { recruit: "base.glb", soldier: "base.glb", centurion: "base.glb" },
      modelsMinimal: { recruit: "base-minimal.glb" },
      layers: { recruit: "recruit.glb", soldier: "soldier.glb", centurion: "elite.glb" },
      layersMinimal: { recruit: "recruit-minimal.glb", soldier: "soldier-minimal.glb", centurion: "elite-minimal.glb" }
    }] }] }));
    const models = ["base", "base-minimal", "recruit", "soldier", "elite",
      "recruit-minimal", "soldier-minimal", "elite-minimal"];
    for (const name of models) put(`armour/${name}.glb`, glb("textures/shared.webp"));
    put("armour/textures/shared.webp", "texture fixture");
    put("mounts/manifest.json", JSON.stringify({
      horse: { model: "horse.glb", coat: { mask: "mask.png" } }, riders: []
    }));
    put("mounts/horse.glb", glb()); put("mounts/mask.png", "mask fixture");
    put("basis/basis_transcoder.js", ""); put("basis/basis_transcoder.wasm", "");
    const plugin = workerAssetsPlugin({ basis: join(folder, "basis"), gameReady: folder });
    const hook = plugin.generateBundle;
    if (typeof hook !== "function") throw new Error("Expected callable worker asset emitter");
    const emitted: string[] = [];
    await hook.call({ emitFile: (asset: { fileName: string }) => { emitted.push(asset.fileName); } } as never,
      {} as never, {}, false);
    for (const name of models) expect(emitted.filter(path => path === `workers/armour/${name}.glb`)).toHaveLength(1);
    expect(emitted.filter(path => path === "workers/armour/textures/shared.webp")).toHaveLength(1);
  } finally { rmSync(folder, { force: true, recursive: true }); }
});
