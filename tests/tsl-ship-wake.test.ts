import { DataTexture, DoubleSide, Mesh, RawShaderMaterial, Vector2, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { createThreeShipWakes } from "../src/renderers/three/settlement/three-ship-wakes";
import { createTslShipWakeMaterial, isShipWakeMaterial } from "../src/renderers/webgpu/tsl/ship-wake";

const fieldTexture = () => {
  const texture = new DataTexture(new Uint8Array(16), 2, 2);
  texture.needsUpdate = true;
  return texture;
};

const uniforms = () => ({
  uAmbientSky: { value: new Vector3(0.3, 0.4, 0.5) },
  uCloudCover: { value: 0.3 },
  uCloudDrift: { value: new Vector2(0.1, 0.2) },
  uColorGradeRain: { value: 0 },
  uColorToneMapper: { value: 0 },
  uColorVividBoost: { value: 0 },
  uExplorationFog: { value: 1 },
  uFogColor: { value: new Vector3(0.7, 0.8, 0.9) },
  uFogOfWarLit: { value: 1 },
  uHighlight: { value: 1 },
  uNoiseTexture: { value: fieldTexture() },
  uRain: { value: 0 },
  uSunColor: { value: new Vector3(1, 0.9, 0.8) },
  uSunDirection: { value: new Vector3(0.3, 0.8, 0.2) },
  uTime: { value: 1 },
  uViewDirection: { value: new Vector3(0, 0.5, 1) },
  uWaterField: { value: fieldTexture() },
  uWorldSize: { value: new Vector2(256, 256) }
});

describe("TSL ship wake twin", () => {
  it("ports the raw wake shader to a transparent node material", () => {
    const source = new RawShaderMaterial({ uniforms: uniforms(), side: DoubleSide });
    source.userData.wg5ShipWake = true;
    expect(isShipWakeMaterial(source)).toBe(true);
    const material = createTslShipWakeMaterial(source);
    expect(material).not.toBeNull();
    expect(material?.name).toBe("wg5:ship-wake");
    expect((material as { isNodeMaterial?: boolean }).isNodeMaterial).toBe(true);
    expect(material?.transparent).toBe(true);
    expect(material?.depthWrite).toBe(false);
    expect(material?.side).toBe(DoubleSide);
    expect(typeof material?.userData.syncUniforms).toBe("function");
    expect(material?.userData.wg5Ported).toBe(true);
  });

  it("tags the WebGL wake material so the presenter ports it instead of standing in", () => {
    const wakes = createThreeShipWakes(1, uniforms(), (_x, _z, out) => {
      out.depth = 4;
      out.height = 0;
    });
    const material = (wakes.mesh as Mesh).material as RawShaderMaterial;
    expect(isShipWakeMaterial(material)).toBe(true);
    expect(material.uniforms).toBeDefined();
    wakes.dispose();
  });
});
