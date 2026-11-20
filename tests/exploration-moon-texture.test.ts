import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping
} from "three";
import { describe, expect, it, vi } from "vitest";

import {
  createExplorationMoonTexture,
  EXPLORATION_MOON_TEXTURE_URL
} from "../src/renderers/three/exploration-weather/exploration-moon-texture";

const fakeMoonImage = (): HTMLImageElement => ({
  height: 1024,
  width: 2048
} as HTMLImageElement);

const deferredImage = () => {
  let resolve!: (image: HTMLImageElement) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<HTMLImageElement>((onLoad, onError) => {
    resolve = onLoad;
    reject = onError;
  });
  return { promise, reject, resolve };
};

describe("exploration moon texture", () => {
  it("uses the bundled local 2K map as deliberately raw display-space albedo", () => {
    const path = fileURLToPath(EXPLORATION_MOON_TEXTURE_URL);
    expect(existsSync(path), path).toBe(true);
    expect(statSync(path).size).toBeGreaterThan(100_000);

    const moon = createExplorationMoonTexture();
    expect(moon.texture).toMatchObject({
      colorSpace: NoColorSpace,
      flipY: false,
      generateMipmaps: true,
      magFilter: LinearFilter,
      minFilter: LinearMipmapLinearFilter,
      name: "exploration-moon-lroc-2k",
      wrapS: RepeatWrapping,
      wrapT: ClampToEdgeWrapping
    });
    expect(moon.stats()).toEqual({ failed: false, live: 1, loaded: false });
    moon.dispose();
  });

  it("starts one image load when constructed and attaches the decoded image once", async () => {
    const pending = deferredImage();
    const loadImage = vi.fn((_url: string) => pending.promise);
    const onReady = vi.fn();
    const moon = createExplorationMoonTexture({ loadImage, onReady });
    expect(loadImage).toHaveBeenCalledOnce();
    expect(loadImage).toHaveBeenCalledWith(EXPLORATION_MOON_TEXTURE_URL);
    expect(moon.texture.image).toBeNull();

    const image = fakeMoonImage();
    pending.resolve(image);
    await expect(moon.imageReady).resolves.toBe(true);
    expect(moon.texture.image).toBe(image);
    expect(moon.texture.version).toBeGreaterThan(0);
    expect(onReady).toHaveBeenCalledOnce();
    expect(moon.stats()).toEqual({ failed: false, live: 1, loaded: true });

    moon.dispose();
    expect(moon.stats().live).toBe(0);
    expect(moon.texture.image).toBeNull();
  });

  it("drops a late image after disposal without touching the disposed texture again", async () => {
    const pending = deferredImage();
    const onReady = vi.fn();
    const moon = createExplorationMoonTexture({
      loadImage: () => pending.promise,
      onReady
    });
    const disposed = vi.fn();
    moon.texture.addEventListener("dispose", disposed);

    moon.dispose();
    expect(disposed).toHaveBeenCalledOnce();
    pending.resolve(fakeMoonImage());
    await expect(moon.imageReady).resolves.toBe(false);
    expect(moon.texture.image).toBeNull();
    expect(moon.stats()).toEqual({ failed: false, live: 0, loaded: false });
    expect(onReady).not.toHaveBeenCalled();
    expect(disposed).toHaveBeenCalledOnce();
  });

  it("contains a failed image load and remains safely disposable", async () => {
    const pending = deferredImage();
    const onReady = vi.fn();
    const moon = createExplorationMoonTexture({
      loadImage: () => pending.promise,
      onReady
    });

    pending.reject(new Error("decode failed"));
    await expect(moon.imageReady).resolves.toBe(false);
    expect(moon.stats()).toEqual({ failed: true, live: 1, loaded: false });
    expect(moon.texture.image).toBeNull();
    expect(onReady).not.toHaveBeenCalled();
    moon.dispose();
    moon.dispose();
    expect(moon.stats().live).toBe(0);
  });
});
