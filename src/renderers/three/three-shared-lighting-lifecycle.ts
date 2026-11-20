import { type Material, type Mesh, type Scene, Texture, type WebGLRenderer } from "three";

/**
 * Three keeps its CPU DFG LUT globally. Renderer.dispose() does not remove that texture's renderer
 * listeners, which retain old programs and scenes. Release its GPU bindings before scene materials
 * disappear; dispose preserves the LUT pixels for subsequent renderer uploads.
 */
export const releaseSharedLightingGpu = (renderer: WebGLRenderer, scene: Scene) => {
  const textures = new Set<Texture>();
  scene.traverse(object => {
    const material = (object as Mesh).material;
    if (!material) return;
    const materials: Material[] = Array.isArray(material) ? material : [material];
    for (const entry of materials) {
      const properties = renderer.properties.get(entry) as {
        uniforms?: Record<string, { value?: unknown }>;
      };
      const texture = properties.uniforms?.dfgLUT?.value;
      if (texture instanceof Texture) textures.add(texture);
    }
  });
  for (const texture of textures) texture.dispose();
};
