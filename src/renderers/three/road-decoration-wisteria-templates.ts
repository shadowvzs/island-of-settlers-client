import { Color, Group, InstancedMesh, MeshStandardMaterial, Object3D, SRGBColorSpace } from "three";

import type { BuildingSurface } from "../../render-common/buildings/building-recipe";
import type { RoadProfilePart } from "../../render-common/road-decoration-recipe";
import { createWisteriaRoadRecipe, WISTERIA_PALETTES, type WisteriaRoadFrame } from "../../render-common/road-decoration-wisteria";
import { createRoadDecorationLeafMaterial } from "./road-decoration-leaf-material";
import { createRoadDecorationModel } from "./road-decoration-model";
import { createRoadDecorationRaceme } from "./road-decoration-raceme";

export type WisteriaPalette = keyof typeof WISTERIA_PALETTES;
interface Template { model: ReturnType<typeof createRoadDecorationModel>; flowers: RoadProfilePart[] }

/** All frames and colours share one neutral raceme geometry/material; colours live in instance buffers. */
export const createWisteriaRoadTemplates = (materials: Record<BuildingSurface, MeshStandardMaterial>, detailed: boolean) => {
  const templates = new Map<WisteriaRoadFrame, Template>(), palettes = new Set<WisteriaPalette>();
  const instances = new Map<Group, InstancedMesh>();
  const flowerMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: .72 });
  const leaf = createRoadDecorationLeafMaterial(detailed);
  const flowerGeometry = createRoadDecorationRaceme({ kind: "wisteria-raceme", position: [0, 0, 0],
    size: [1, 1, 1], surface: "paint", tint: [1, 1, 1] }, detailed);
  const triangleCount = flowerGeometry.getAttribute("position").count / 3;
  const transform = new Object3D();
  let disposed = false;
  const release = (root: Group) => {
    const flowers = instances.get(root);
    if (!flowers) return;
    flowers.dispose(); instances.delete(root); root.clear(); root.removeFromParent();
  };
  const instantiate = (frame: WisteriaRoadFrame, palette: WisteriaPalette) => {
    if (disposed) throw new Error("Wisteria templates are disposed");
    let template = templates.get(frame);
    if (!template) {
      const recipe = createWisteriaRoadRecipe(frame, detailed);
      const flowers = recipe.parts.filter((part): part is RoadProfilePart => "kind" in part && part.kind === "wisteria-raceme");
      const parts = recipe.parts.filter(part => !("kind" in part) || part.kind !== "wisteria-raceme");
      template = { model: createRoadDecorationModel({ ...recipe, parts }, { ...materials, leaf: leaf.material }, detailed), flowers };
      templates.set(frame, template);
    }
    const root = template.model.root.clone(true), colour = WISTERIA_PALETTES[palette];
    const tint = new Color().setRGB(colour[0], colour[1], colour[2], SRGBColorSpace);
    const flowers = new InstancedMesh(flowerGeometry, flowerMaterial, template.flowers.length);
    flowers.name = "paint"; flowers.castShadow = detailed; flowers.receiveShadow = detailed;
    for (let index = 0; index < template.flowers.length; index++) {
      const part = template.flowers[index]!;
      transform.position.set(...part.position); transform.scale.set(...part.size);
      const rotation = part.rotation ?? [0, 0, 0];
      transform.rotation.set(rotation[0], rotation[1], rotation[2], "ZYX"); transform.updateMatrix();
      flowers.setMatrixAt(index, transform.matrix); flowers.setColorAt(index, tint);
    }
    flowers.instanceMatrix.needsUpdate = true;
    if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
    flowers.computeBoundingSphere(); flowers.computeBoundingBox(); root.add(flowers);
    instances.set(root, flowers); palettes.add(palette);
    return { root, triangles: template.model.triangles + triangleCount * flowers.count, dispose: () => release(root) };
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const root of instances.keys()) release(root);
    for (const { model } of templates.values()) model.dispose(); templates.clear();
    flowerMaterial.dispose(); flowerGeometry.dispose(); leaf.dispose(); palettes.clear();
  };
  return { instantiate, dispose, statistics: () => ({ structures: templates.size, palettes: palettes.size,
    flowerGeometries: 1, flowerMaterials: 1, instances: instances.size }) };
};
