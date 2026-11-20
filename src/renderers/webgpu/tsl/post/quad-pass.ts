import {
  AddEquation,
  CustomBlending,
  NoBlending,
  NodeMaterial,
  OneFactor,
  QuadMesh,
  type RenderTarget,
  type WebGPURenderer
} from "three/webgpu";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

export interface PassMaterialOptions {
  /** Additive One/One blending: the upsample adds onto the finer mip instead of replacing it. */
  additive?: boolean;
}

/** A fragment-only node material for a fullscreen pass. */
export const createPassMaterial = (
  name: string, fragmentNode: TslNode, { additive = false }: PassMaterialOptions = {}
): NodeMaterial => {
  const material = new NodeMaterial();
  material.name = name;
  material.depthTest = false;
  material.depthWrite = false;
  material.fragmentNode = fragmentNode;
  material.blending = additive ? CustomBlending : NoBlending;
  if (!additive) return material;
  material.blendSrc = OneFactor;
  material.blendDst = OneFactor;
  material.blendEquation = AddEquation;
  material.blendSrcAlpha = OneFactor;
  material.blendDstAlpha = OneFactor;
  material.transparent = true;
  return material;
};

/**
 * Three's `QuadMesh` renders a fullscreen triangle with the vertex contract a post pass needs
 * (the clip position comes from the vertex index, not the camera). A single mesh is reused for
 * every pass by swapping its material; the geometry is Three's shared static.
 */
export interface QuadPass {
  dispose: () => void;
  draw: (material: NodeMaterial, destination: RenderTarget | null) => void;
}

export const createQuadPass = (renderer: WebGPURenderer): QuadPass => {
  const mesh = new QuadMesh(new NodeMaterial());
  return {
    dispose: () => {
      if (Array.isArray(mesh.material)) for (const material of mesh.material) material.dispose();
      else mesh.material.dispose();
    },
    draw: (material, destination) => {
      mesh.material = material;
      renderer.setRenderTarget(destination);
      mesh.render(renderer);
    }
  };
};
