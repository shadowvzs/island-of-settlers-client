import { BoxGeometry, Mesh, MeshStandardMaterial, Texture, TextureLoader } from "three";
import { expect, it } from "vitest";

import { trackBuildingExportTextureLoads } from "../tools/bench/building-export-texture-readiness";

const fixture = () => {
  const original = TextureLoader.prototype.load;
  const pending: { texture: Texture<HTMLImageElement>; loaded?: (texture: Texture<HTMLImageElement>) => void;
    error?: (error: unknown) => void }[] = [];
  TextureLoader.prototype.load = (_url, loaded, _progress, error) => {
    const texture = new Texture<HTMLImageElement>(); pending.push({ texture, loaded, error }); return texture;
  };
  const tracked = trackBuildingExportTextureLoads();
  return { pending, tracked, restore: () => { tracked.restore(); TextureLoader.prototype.load = original; } };
};

it("awaits the real image callback once for a texture shared across material slots", async () => {
  const test = fixture();
  try {
    const texture = new TextureLoader().load("/spyglass.png"), material = new MeshStandardMaterial({ map: texture,
      emissiveMap: texture }), mesh = new Mesh(new BoxGeometry(), material);
    let settled = false; const ready = test.tracked.wait(mesh).then(() => { settled = true; return settled; });
    await Promise.resolve(); expect(settled).toBe(false); expect(test.pending).toHaveLength(1);
    (texture as Texture).image = { width: 2, height: 1, data: new Uint8Array(8) };
    test.pending[0]!.loaded!(texture); await ready;
    expect(settled).toBe(true); expect(material.map).toBe(texture); expect(material.emissiveMap).toBe(texture);
  } finally { test.restore(); }
});

it("propagates image-load errors and preserves the existing error callback", async () => {
  const test = fixture();
  try {
    let errors = 0;
    const texture = new TextureLoader().load("/coins.png", undefined, undefined, () => { errors++; });
    const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map: texture }));
    const ready = test.tracked.wait(mesh);
    test.pending[0]!.error!(new Error("missing asset"));
    await expect(ready).rejects.toThrow("failed to load: /coins.png");
    expect(errors).toBe(1); expect(texture.image).toBeNull();
  } finally { test.restore(); }
});

it("rejects an image cleared by its owner callback instead of hiding a disposal error", async () => {
  const test = fixture();
  try {
    const texture = new TextureLoader().load("/abandoned.png", loaded => { (loaded as Texture).image = null; });
    const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map: texture }));
    const ready = test.tracked.wait(mesh);
    (texture as Texture).image = { width: 1, height: 1 };
    test.pending[0]!.loaded!(texture);
    await expect(ready).rejects.toThrow("cleared/disposed: /abandoned.png");
    expect(texture.image).toBeNull();
  } finally { test.restore(); }
});

it("rejects untracked missing images and restores the exact loader method", async () => {
  const original = TextureLoader.prototype.load, tracked = trackBuildingExportTextureLoads();
  try {
    const texture = new Texture(), mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map: texture }));
    await expect(tracked.wait(mesh)).rejects.toThrow("no tracked load (missing/disposed)");
    expect(texture.image).toBeNull();
  } finally { tracked.restore(); }
  expect(TextureLoader.prototype.load).toBe(original);
});
