import { CustomBlending, DataTexture } from "three";
import { describe, expect, it } from "vitest";

import {
  createContactShadowMesh, createContactShadows
} from "../src/renderers/three/three-contact-shadows";
import {
  createTslContactShadowMaterial, isContactShadowMaterial
} from "../src/renderers/webgpu/tsl/contact-shadow";

const noise = () => new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);

describe("TSL contact-shadow decal", () => {
  it("marks both WebGL contact decals for the node port", () => {
    const generic = createContactShadowMesh({});
    const planted = createContactShadows({ count: 0 } as never, [], {});
    expect(isContactShadowMaterial(generic.mesh.material)).toBe(true);
    expect(isContactShadowMaterial(planted.mesh.material)).toBe(true);
    expect(generic.mesh.material.blending).toBe(CustomBlending);
    generic.dispose();
    planted.mesh.geometry.dispose();
    planted.mesh.material.dispose();
  });

  it("ports the multiply decal to a node material with the shared uniforms", () => {
    const source = createContactShadowMesh({ uNoiseTexture: { value: noise() } });
    const material = createTslContactShadowMaterial(source.mesh.material);
    expect(material?.name).toBe("tsl:contact-shadow");
    expect((material as { isMeshBasicNodeMaterial?: boolean }).isMeshBasicNodeMaterial).toBe(true);
    expect(material?.blending).toBe(CustomBlending);
    expect(material?.depthWrite).toBe(false);
    expect(material?.userData.wg4Ported).toBe(true);
    expect(typeof material?.userData.syncUniforms).toBe("function");
    material?.dispose();
    source.dispose();
  });

  it("refuses a decal without the shared noise uniform", () => {
    const source = createContactShadowMesh({});
    expect(createTslContactShadowMaterial(source.mesh.material)).toBeNull();
    source.dispose();
  });
});
