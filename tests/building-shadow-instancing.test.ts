import { MeshStandardMaterial } from "three";
import { expect, it } from "vitest";

import { connectSunShadowReceivers } from "../src/renderers/three/buildings/building-shadows";

it("includes the instance matrix when a decorated material receives sun shadows", () => {
  const material = new MeshStandardMaterial();
  connectSunShadowReceivers([material], {});
  const shader = {
    uniforms: {},
    vertexShader: "#include <project_vertex>",
    fragmentShader: "#include <lights_fragment_end>"
  };
  material.onBeforeCompile(shader as never, {} as never);
  expect(shader.vertexShader).toContain("instanceMatrix*vec4(transformed");
  expect(shader.vertexShader).toContain("#ifdef USE_INSTANCING");
  expect(material.customProgramCacheKey()).toBe("roman-island-shadow-v1-i1");
});
