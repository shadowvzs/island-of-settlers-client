import { BufferGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, Vector2 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import {
  type AdventureCampFrame
} from "../../../render-common/adventure/adventure-camp";
import { adventureCampLayout } from "../../../shared/settlement/adventure-camp-layout";
import { displayFogAt } from "../../../shared/world/fog-display";
import { createCampFabricTextures } from "./camp-fabric-textures";
export { adventureCampLayout } from "../../../shared/settlement/adventure-camp-layout";
import { sampleSmooth } from "../../../shared/world/grid-geometry";
import { FOG, type WorldData } from "../../../shared/world/world-data";
import { createAdventureCampDecoration } from "./adventure-camp-model";
import { attachAdventureCampWind, CAMP_CLOTH_MAX_DISPLACEMENT } from "./adventure-camp-wind";

interface CampView {
  mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  revision: string;
  fogCells: number[];
}

/** Static canvas field camps: one palette draw per camp, one High weave map and no animation tick. */
export const createThreeAdventureCamps = (world: WorldData, detailed: boolean) => {
  const root = new Group(); root.name = "adventure_field_camps";
  const fabric = createCampFabricTextures(detailed, 12);
  const material = new MeshStandardMaterial({ map: fabric.map, normalMap: fabric.normalMap,
    normalScale: new Vector2(.22, .22), roughnessMap: fabric.roughnessMap,
    roughness: .97, side: DoubleSide, vertexColors: true });
  const wind = attachAdventureCampWind(material);
  const recipes = new Map<string, BufferGeometry>();
  const views = new Map<string, CampView>();
  const emptySites = new Map<string, string>();
  const build = (
    camp: AdventureCampFrame, camps: readonly AdventureCampFrame[], revision: string, detail: boolean
  ) => {
    const parts: BufferGeometry[] = [], fogCells = new Set<number>([
      Math.floor(camp.z) * world.cellsX + Math.floor(camp.x)
    ]);
    for (const decoration of adventureCampLayout(world, camp, camps)) {
      const recipeKey = `${decoration.kind}:${decoration.variant ?? "shelter"}:${camp.theme ?? "bandit"}:${detail}`;
      let template = recipes.get(recipeKey);
      if (!template) {
        template = createAdventureCampDecoration(decoration.kind, detail, camp.theme, decoration.variant);
        recipes.set(recipeKey, template);
      }
      const geometry = template.clone();
      geometry.rotateY(decoration.yaw);
      geometry.translate(camp.x + decoration.x, 0, camp.z + decoration.z);
      const positions = geometry.getAttribute("position");
      for (let vertex = 0; vertex < positions.count; vertex++) {
        const x = positions.getX(vertex), z = positions.getZ(vertex);
        positions.setY(vertex, positions.getY(vertex) + sampleSmooth(world, world.heights, x, z) + .035);
        for (const dx of [-CAMP_CLOTH_MAX_DISPLACEMENT, CAMP_CLOTH_MAX_DISPLACEMENT])
          for (const dz of [-CAMP_CLOTH_MAX_DISPLACEMENT, CAMP_CLOTH_MAX_DISPLACEMENT])
            fogCells.add(Math.floor(z + dz) * world.cellsX + Math.floor(x + dx));
      }
      geometry.computeVertexNormals(); parts.push(geometry);
    }
    if (!parts.length) return undefined;
    const geometry = mergeGeometries(parts, false)!; parts.forEach(part => part.dispose());
    geometry.computeBoundingSphere();
    if (geometry.boundingSphere) geometry.boundingSphere.radius += CAMP_CLOTH_MAX_DISPLACEMENT;
    const mesh = new Mesh(geometry, material); mesh.name = `adventure_camp_${camp.id}`;
    mesh.castShadow = detail; mesh.receiveShadow = true; root.add(mesh);
    return { fogCells: [...fogCells], mesh, revision };
  };
  const update = (
    camps: readonly AdventureCampFrame[], zoom = 1, time = 0, windX = 0, windZ = 0
  ) => {
    wind.update(time, windX, windZ);
    for (const view of views.values()) view.mesh.visible = false;
    const detail = detailed && zoom >= .5;
    const layout = camps.map(camp => `${camp.id}:${camp.x}:${camp.z}:${camp.theme ?? "bandit"}`).join(";");
    const revision = `${world.terrainRevision ?? 0}:${world.buildRevision ?? 0}:${world.props.count}:${detail}:${layout}`;
    for (const camp of camps) {
      const key = `${camp.id}:${camp.x}:${camp.z}:${camp.theme ?? "bandit"}`;
      let view = views.get(key);
      if (view && view.revision !== revision) {
        root.remove(view.mesh); view.mesh.geometry.dispose(); views.delete(key); view = undefined;
      }
      if (!view && emptySites.get(key) !== revision) {
        view = build(camp, camps, revision, detail);
        if (view) views.set(key, view);
        else emptySites.set(key, revision);
      }
      if (!view) continue;
      // Whole-footprint visibility is deliberately conservative: no hidden tent over a fog boundary.
      view.mesh.visible = !camp.fogEnabled || view.fogCells.every(cell => displayFogAt(world, cell) === FOG.visible);
    }
    const active = new Set(camps.map(camp => `${camp.id}:${camp.x}:${camp.z}:${camp.theme ?? "bandit"}`));
    for (const key of emptySites.keys()) if (!active.has(key)) emptySites.delete(key);
    for (const [key, view] of views) if (!active.has(key)) {
      root.remove(view.mesh); view.mesh.geometry.dispose(); views.delete(key);
    }
  };
  return { root, update, dispose: () => {
    for (const view of views.values()) view.mesh.geometry.dispose();
    for (const recipe of recipes.values()) recipe.dispose();
    views.clear(); emptySites.clear(); recipes.clear(); root.clear(); material.dispose(); fabric.dispose();
  } };
};
