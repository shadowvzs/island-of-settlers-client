import { readFileSync } from "node:fs";
import { DataTexture, RGBAFormat } from "three";
import { expect, it, vi } from "vitest";

import { createWisteriaTreeTemplates, type WisteriaTreeAtlas } from "../src/renderers/three/plants/wisteria-tree-templates";
import type { WisteriaLodAtlasMetadata } from "../src/renderers/three/wisteria-lod-atlas";

const metadata = JSON.parse(readFileSync(new URL(
  "../assets/botanical-textures/wisteria-owned-lod-atlas-candidate.json", import.meta.url), "utf8")) as
  WisteriaLodAtlasMetadata;
const atlas = (): WisteriaTreeAtlas => ({
  texture: new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat),
  tissue: new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat), metadata
});

it("shares pending botanical loading and preserves borrowed maps until the last tree releases", async () => {
  let complete: (value: WisteriaTreeAtlas) => void = () => {};
  const request = new Promise<WisteriaTreeAtlas>(resolve => { complete = resolve; });
  const load = vi.fn(() => request), owner = createWisteriaTreeTemplates(false, load);
  const first = owner.create(0), second = owner.create(1, "far"), source = atlas();
  const disposed = vi.fn(), tissueDisposed = vi.fn(); source.texture.addEventListener("dispose", disposed);
  source.tissue.addEventListener("dispose", tissueDisposed);
  expect(load).toHaveBeenCalledTimes(1);
  complete(source);
  const models = await Promise.all([first, second]);
  models[0].dispose(); models[0].dispose();
  expect(disposed).not.toHaveBeenCalled();
  expect(tissueDisposed).not.toHaveBeenCalled();
  expect(owner.statistics().users).toBe(1);
  models[1].dispose();
  expect(disposed).toHaveBeenCalledTimes(1);
  expect(tissueDisposed).toHaveBeenCalledTimes(1);
  expect(owner.statistics()).toEqual({ users: 0, ready: false, pending: false });
  owner.dispose();
});

it("disposes a late atlas after its map owner closes without attaching a stale model", async () => {
  let complete: (value: WisteriaTreeAtlas) => void = () => {};
  const request = new Promise<WisteriaTreeAtlas>(resolve => { complete = resolve; });
  const owner = createWisteriaTreeTemplates(false, () => request);
  const model = owner.create(), source = atlas(), disposed = vi.fn(), tissueDisposed = vi.fn();
  source.texture.addEventListener("dispose", disposed);
  source.tissue.addEventListener("dispose", tissueDisposed);
  owner.dispose(); complete(source);
  await expect(model).rejects.toThrow("disposed");
  expect(disposed).toHaveBeenCalledTimes(1);
  expect(tissueDisposed).toHaveBeenCalledTimes(1);
  expect(owner.statistics()).toEqual({ users: 0, ready: false, pending: false });
  await expect(owner.create()).rejects.toThrow("disposed");
});

it("releases bad metadata and permits a later fresh successful request", async () => {
  const invalid = atlas(), disposed = vi.fn(), tissueDisposed = vi.fn();
  invalid.texture.addEventListener("dispose", disposed); invalid.tissue.addEventListener("dispose", tissueDisposed);
  invalid.metadata = { ...metadata, racemeSpan: 0 };
  const load = vi.fn().mockResolvedValueOnce(invalid).mockImplementation(async () => atlas());
  const owner = createWisteriaTreeTemplates(false, load);
  await expect(owner.create()).rejects.toThrow("metadata");
  expect(disposed).toHaveBeenCalledTimes(1);
  expect(tissueDisposed).toHaveBeenCalledTimes(1);
  const good = await owner.create(2, "far");
  expect(good.triangles).toBeLessThanOrEqual(2400);
  expect(load).toHaveBeenCalledTimes(2);
  good.dispose(); owner.dispose();
});
