import type { BufferGeometry, Material, Object3D, WebGPURenderer } from "three/webgpu";

import type { createInstanceMatrixVariants } from "./instance-matrix-variants";
import type { MaterialPorting } from "./webgpu-spike-material-porter";
import { needsStandInMapSync } from "./stand-in-map";
import type { createShaderRequests } from "./presenter-hooks";
import type { createSunShadowPass } from "./sun-shadow-pass";
import type { createVertexBufferPacker } from "./vertex-buffer-packing";

type RenderObjectFunction = NonNullable<Parameters<WebGPURenderer["setRenderObjectFunction"]>[0]>;

type TslNode = any; // TSL's generated types do not model the proxied node methods.

interface DrawObjectDeps {
  createStandIn: (
    source: Material, object: Object3D, usedTextures: boolean, copyTexture: MaterialPorting["copyTextureOnce"],
    sunVisibility: TslNode | null
  ) => Material;
  copyTextures: boolean;
  instanceMatrixVariant: ReturnType<typeof createInstanceMatrixVariants>;
  materials: MaterialPorting;
  packer: ReturnType<typeof createVertexBufferPacker>;
  renderer: WebGPURenderer;
  shaderRequests: ReturnType<typeof createShaderRequests>;
  sunShadows: Pick<ReturnType<typeof createSunShadowPass>, "active" | "materialFor">;
}

const isNodeMaterial = (material: Material) => (material as { isNodeMaterial?: boolean }).isNodeMaterial === true;

/**
 * C-3 per-draw hook: draws over-limit vertex layouts through their packed twin and substitutes node materials.
 * Kept separate from the presenter so the renderer setup stays under the file-size limit.
 */
export const createDrawObject = (deps: DrawObjectDeps): RenderObjectFunction =>
  (object, scene, camera, geometry, material, group, lightsNode, clippingContext, passId) => {
    const override = (scene as { overrideMaterial?: Material | null }).overrideMaterial;
    let drawn = material;
    if (override != null && material === override) {
      drawn = deps.materials.overrideStandInFor(override, scene);
    } else if (deps.sunShadows.active) {
      const depth = deps.sunShadows.materialFor(object, material);
      if (depth === undefined) return;
      drawn = depth;
    } else if (!isNodeMaterial(material)) {
      deps.materials.replaceObjectMaterials(object);
      const replaced = (object as unknown as { material: Material | Material[] }).material;
      drawn = Array.isArray(replaced) ? replaced[group?.materialIndex ?? 0] ?? material : replaced;
    }
    if (!isNodeMaterial(drawn)) {
      const source = drawn as Material;
      drawn = deps.createStandIn(source, object, deps.copyTextures, deps.materials.copyTextureOnce, null);
      deps.materials.standInSources.set(drawn as Material, source);
      const target = object as { material?: Material | Material[] };
      if (Array.isArray(target.material) && group !== null)
        target.material[group.materialIndex ?? 0] = drawn as Material;
      else target.material = drawn as Material;
    } else {
      const source = deps.materials.standInSources.get(drawn as Material);
      if (source !== undefined && needsStandInMapSync(drawn, source)) {
        const replacement = deps.createStandIn(source, object, deps.copyTextures, deps.materials.copyTextureOnce, null);
        deps.materials.standInSources.set(replacement, source);
        const target = object as { material?: Material | Material[] };
        if (Array.isArray(target.material) && group !== null)
          target.material[group.materialIndex ?? 0] = replacement;
        else target.material = replacement;
        drawn = replacement;
      }
    }
    const sync = drawn.userData.syncUniforms;
    if (typeof sync === "function") deps.materials.portedSync.add(sync as () => void);
    drawn = deps.instanceMatrixVariant(drawn, object);
    deps.shaderRequests.capture(drawn, scene, camera, object);
    const twin = deps.packer.twinOf(geometry);
    if (twin === null) {
      deps.renderer.renderObject(object, scene, camera, geometry, drawn, group, lightsNode, clippingContext, passId);
      return;
    }
    const mesh = object as Object3D & { geometry: BufferGeometry };
    mesh.geometry = twin;
    try {
      deps.renderer.renderObject(object, scene, camera, twin, drawn, group, lightsNode, clippingContext, passId);
    } finally {
      mesh.geometry = geometry;
    }
  };
