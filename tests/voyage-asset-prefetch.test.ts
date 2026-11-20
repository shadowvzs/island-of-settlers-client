import { afterEach, expect, it, vi } from "vitest";

import { glbImageUris, prefetchVoyageAssets } from "../src/app/voyage-asset-prefetch";

const glb = () => {
  const json = new TextEncoder().encode(JSON.stringify({ images: [
    { uri: "body.ktx2" }, { bufferView: 1 }, { uri: "data:image/png;base64,abc" }
  ] }));
  const buffer = new ArrayBuffer(20 + json.length);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(12, json.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20).set(json);
  return buffer;
};
afterEach(() => vi.unstubAllGlobals());

const MOUNTS = {
  horse: { coat: { mask: "horse/mask.png" }, model: "horse/model.glb" },
  riders: [
    { animations: "riders/r/actions.glb", model: "riders/r/model.glb", nation: "roman", variant: "r" },
    { animations: "riders/v/actions.glb", model: "riders/v/model.glb", nation: "viking", variant: "v" }
  ]
};
const manifestOf = (path: string) => path.includes("mounts/manifest") ? MOUNTS : undefined;

it("discovers external GLB textures without fetching embedded images", () => {
  expect(glbImageUris(glb())).toEqual(["body.ktx2"]);
  expect(glbImageUris(new ArrayBuffer(4))).toEqual([]);
});

it.each([true, false])("warms active-detail nation/enemy assets serially (High=%s)", async detailed => {
  vi.stubGlobal("document", { baseURI: "https://game.test/play/" });
  const urls: string[] = [];
  let active = 0;
  let peak = 0;
  vi.stubGlobal("fetch", async (url: URL) => {
    urls.push(url.href);
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    const json = manifestOf(url.pathname) ?? (url.pathname.includes("tripo") ? { workers: [
      { nation: "japanese", model: "j/model.glb", modelMinimal: "j/model-minimal.glb", animations: "j/actions.glb" },
      { nation: "roman", model: "r/model.glb", animations: "r/actions.glb" },
      { nation: "viking", model: "v/model.glb", animations: "v/actions.glb" }
    ] } : { sets: [{ nation: "japanese", bodies: [
      { animations: "../tripo/j/actions.glb", files: { helmet: "j/helmet.glb" },
        filesMinimal: { helmet: "j/helmet-minimal.glb" }, models: { recruit: "j/body.glb" },
        modelsMinimal: { recruit: "j/body-minimal.glb" },
        layers: { recruit: "j/layer.glb" }, layersMinimal: { recruit: "j/layer-minimal.glb" } }
    ] }] });
    return { ok: true, json: async () => json, arrayBuffer: async () => glb() };
  });
  await prefetchVoyageAssets("japanese", detailed, () => true, "roman");
  expect(peak).toBe(1);
  expect(urls).toContain("https://game.test/play/workers/armour/j/body.ktx2");
  expect(urls).toContain("https://game.test/play/workers/tripo/r/model.glb");
  const suffix = detailed ? "" : "-minimal";
  expect(urls).toContain(`https://game.test/play/workers/tripo/j/model${suffix}.glb`);
  expect(urls).toContain(`https://game.test/play/workers/armour/j/body${suffix}.glb`);
  expect(urls).toContain(`https://game.test/play/workers/armour/j/helmet${suffix}.glb`);
  expect(urls).toContain(`https://game.test/play/workers/armour/j/layer${suffix}.glb`);
  expect(urls).not.toContain(`https://game.test/play/workers/armour/j/layer${detailed ? "-minimal" : ""}.glb`);
  expect(urls).not.toContain(`https://game.test/play/workers/armour/j/body${detailed ? "-minimal" : ""}.glb`);
  expect(urls.some(url => url.includes("/v/"))).toBe(false);
  expect(urls.filter(url => url.endsWith("j/actions.glb"))).toHaveLength(1);
  expect(urls.includes("https://game.test/play/workers/mounts/horse/model.glb")).toBe(detailed);
  expect(urls).toContain("https://game.test/play/workers/mounts/horse/mask.png");
  expect(urls).toContain("https://game.test/play/workers/mounts/riders/r/actions.glb");
  expect(urls.some(url => url.includes("riders/v/"))).toBe(false);
});
