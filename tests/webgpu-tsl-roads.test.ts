import { DataTexture, Vector2, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { createRoadMaterial } from "../src/renderers/three/settlement/road-materials";
import { createTerritoryMarkerMaterial } from "../src/renderers/three/settlement/territory-marker-material";
import { createTslRoadMaterial, isRoadMaterial } from "../src/renderers/webgpu/tsl/road";
import {
  createTslTerritoryMarkerMaterial, isTerritoryMarkerMaterial
} from "../src/renderers/webgpu/tsl/territory-marker";

describe("TSL-4 road and territory marker ports", () => {
  it("ports the current dirt road material with its map relief and vertex-alpha edge", () => {
    const source = createRoadMaterial("dirt", true);
    const material = createTslRoadMaterial(source, texture => texture ?? undefined);
    const node = material as unknown as { bumpMap?: unknown; colorNode?: unknown; opacityNode?: unknown };
    expect(isRoadMaterial(source)).toBe(true);
    expect(material?.name).toBe("tsl:road-dirt");
    expect(material?.transparent).toBe(true);
    expect(material?.depthWrite).toBe(false);
    expect(node.colorNode).toBeDefined();
    expect(node.opacityNode).toBeDefined();
    expect(node.bumpMap).toBeDefined();
    expect(typeof material?.userData.syncUniforms).toBe("function");
    material?.dispose();
    source.map?.dispose();
    source.bumpMap?.dispose();
    source.dispose();
  });

  it("ports both territory marker variants", () => {
    const uniforms = {
      uAmbientSky: { value: new Vector3(0.5, 0.6, 0.8) },
      uCloudCover: { value: 0.4 },
      uCloudDrift: { value: new Vector2(1, 2) },
      uHighlight: { value: 0.8 },
      uNoiseTexture: { value: new DataTexture(new Uint8Array(4), 1, 1) },
      uPlayerColor: { value: new Vector3(0.3, 0.5, 0.9) },
      uRain: { value: 0 },
      uSkyIrradiance: { value: new Float32Array(27) },
      uSunColor: { value: new Vector3(1, 0.9, 0.8) },
      uSunDirection: { value: new Vector3(0.3, 0.8, 0.2) },
      uViewDirection: { value: new Vector3(0, 0.5, 1) }
    };
    const source = createTerritoryMarkerMaterial(uniforms, true);
    const depth = createTerritoryMarkerMaterial(uniforms, false, true);
    const material = createTslTerritoryMarkerMaterial(source);
    const depthMaterial = createTslTerritoryMarkerMaterial(depth);
    expect(isTerritoryMarkerMaterial(source)).toBe(true);
    expect(material?.name).toBe("tsl:territory-marker");
    expect((material as unknown as { colorNode?: unknown }).colorNode).toBeDefined();
    expect(typeof material?.userData.syncUniforms).toBe("function");
    expect(depthMaterial?.name).toBe("tsl:territory-marker-depth");
    expect(depthMaterial?.colorWrite).toBe(false);
    material?.dispose();
    depthMaterial?.dispose();
    source.dispose();
    depth.dispose();
  });
});
