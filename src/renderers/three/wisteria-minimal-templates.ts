import {
  Color, DoubleSide, Group, InstancedMesh, MeshStandardMaterial,
  SRGBColorSpace, type Texture
} from "three";

import { createWisteriaBotanicalMaterials } from "./wisteria-botanical-materials";
import type { WisteriaFlowerInstance, WisteriaLeafInstance } from "./wisteria-botanical-templates";
import {
  createWisteriaCrossCard, groupWisteriaBotany,   type WisteriaLodAtlasMetadata,
wisteriaRacemeTransform, wisteriaSprayTransform} from "./wisteria-lod-atlas";

/** Fixed botanical greens occupy their own tiles/surface; flower palette affects only neutral petals. */
export const createWisteriaMinimalTemplates = (atlas: Texture, metadata: WisteriaLodAtlasMetadata) => {
  if (metadata.version !== 2 || ![metadata.racemeSpan, metadata.spraySpan].every(value => Number.isFinite(value) && value > 0)) throw new Error("Unsupported Wisteria LOD atlas");
  atlas.colorSpace = SRGBColorSpace;
  const base = createWisteriaBotanicalMaterials();
  const surface = new MeshStandardMaterial({ map: atlas, alphaTest: .32, side: DoubleSide, roughness: .9 });
  const geometry = {
    flowers: createWisteriaCrossCard("racemeFront", "racemeSide"),
    fixed: createWisteriaCrossCard("fixedFront", "fixedSide"),
    leaves: createWisteriaCrossCard("sprayFront", "spraySide")
  };
  const live = new Set<Group>(), colour = new Color();
  let disposed = false;
  const materials = { ...base, atlasReady: () => true, atlasFailed: () => false };
  const instantiate = (flowers: readonly WisteriaFlowerInstance[], leaves: readonly WisteriaLeafInstance[],
    palette: readonly [number, number, number] = [.75, .62, .92]) => {
    if (disposed) throw new Error("Botanical Wisteria templates are disposed");
    const clusters = groupWisteriaBotany(flowers, "cluster"), sprays = groupWisteriaBotany(leaves, "spray");
    const root = new Group(), petals = new InstancedMesh(geometry.flowers, surface, clusters.length);
    const fixed = new InstancedMesh(geometry.fixed, surface, clusters.length);
    const foliage = new InstancedMesh(geometry.leaves, surface, sprays.length);
    petals.name = "wisteria_minimal_neutral_racemes"; fixed.name = "wisteria_minimal_fixed_calyces";
    foliage.name = "wisteria_minimal_pinnate_sprays";
    clusters.forEach((cluster, index) => {
      const matrix = wisteriaRacemeTransform(cluster, metadata);
      petals.setMatrixAt(index, matrix); fixed.setMatrixAt(index, matrix);
      colour.setRGB(...palette, SRGBColorSpace); petals.setColorAt(index, colour);
    });
    sprays.forEach((spray, index) => {
      foliage.setMatrixAt(index, wisteriaSprayTransform(spray, metadata));
    });
    root.add(petals, fixed, foliage);
    for (const mesh of [petals, fixed, foliage]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = false; mesh.receiveShadow = true;
      mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    }
    live.add(root); let released = false;
    return { root, dispose: () => {
      if (released) return; released = true;
      for (const mesh of [petals, fixed, foliage]) mesh.dispose();
      root.removeFromParent(); root.clear(); live.delete(root);
    } };
  };
  return { materials, instantiate, dispose: () => {
    if (disposed) return; disposed = true;
    for (const root of live) {
      root.traverse(node => { if (node instanceof InstancedMesh) node.dispose(); });
      root.removeFromParent(); root.clear();
    }
    live.clear(); Object.values(geometry).forEach(value => value.dispose());
    surface.dispose(); atlas.dispose(); atlas.image = null; base.dispose();
  } };
};
