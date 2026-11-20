import { DataTexture, MeshStandardMaterial, RGBAFormat, UnsignedByteType } from "three";
import { describe, expect, it } from "vitest";

import {
  copySourceTexture, syncStandInMaps
} from "../src/renderers/three/webgpu/stand-in-map";

const pixels = (value: number) => new Uint8Array(4 * 4 * 4).fill(value);

const sourceTexture = (name: string) => {
  const texture = new DataTexture(pixels(180), 4, 4, RGBAFormat, UnsignedByteType);
  texture.name = name;
  texture.needsUpdate = true;
  return texture;
};

describe("WebGPU ship stand-in map sync", () => {
  it("copies a map that arrives after the stand-in was built and drops the fallback tint", () => {
    const source = new MeshStandardMaterial();
    const standIn = new MeshStandardMaterial({ color: 0x9aa0a6 });
    expect(syncStandInMaps(standIn, source, copySourceTexture)).toBe(false);
    const timber = sourceTexture("premium-timber");
    source.map = timber;
    expect(syncStandInMaps(standIn, source, copySourceTexture)).toBe(true);
    expect(standIn.map).not.toBe(timber);
    expect(standIn.map?.name).toBe("wg0:premium-timber");
    expect(standIn.map?.userData.wg0Copied).toBe(true);
    expect(standIn.color.getHex()).toBe(0xffffff);
  });

  it("keeps an explicit source tint and syncs every lit map, including bump and emissive", () => {
    const source = new MeshStandardMaterial({ color: 0x917257 });
    const standIn = new MeshStandardMaterial({ color: 0xffffff });
    source.map = sourceTexture("timber");
    source.normalMap = sourceTexture("timber-normal");
    source.roughnessMap = sourceTexture("timber-roughness");
    source.metalnessMap = sourceTexture("timber-metalness");
    source.bumpMap = sourceTexture("timber-relief");
    source.emissiveMap = sourceTexture("lantern");
    expect(syncStandInMaps(standIn, source, copySourceTexture)).toBe(true);
    expect(standIn.color.getHex()).toBe(0x917257);
    expect(standIn.normalMap?.name).toBe("wg0:timber-normal");
    expect(standIn.roughnessMap?.name).toBe("wg0:timber-roughness");
    expect(standIn.metalnessMap?.name).toBe("wg0:timber-metalness");
    expect(standIn.bumpMap?.name).toBe("wg0:timber-relief");
    expect(standIn.emissiveMap?.name).toBe("wg0:lantern");
    expect(syncStandInMaps(standIn, source, copySourceTexture)).toBe(false);
  });

  it("leaves compressed source maps in place when their pixels cannot be copied", () => {
    const source = new MeshStandardMaterial();
    const compressed = sourceTexture("ktx2");
    Object.assign(compressed, { isCompressedTexture: true });
    const image = compressed.image as { data: Uint8Array | null };
    image.data = null;
    source.map = compressed;
    const standIn = new MeshStandardMaterial();
    expect(syncStandInMaps(standIn, source, copySourceTexture)).toBe(true);
    expect(standIn.map).toBe(compressed);
  });
});
