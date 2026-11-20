import { type Camera,Group, Mesh, type MeshStandardMaterial, type Raycaster, Scene, type WebGLRenderer } from "three";

import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import type { FrameState } from "../../../render-common/renderer-contract";
import { createDepositSignPlacement } from "../../../render-common/rocks/deposit-sign-placement";
import { displayFogAt } from "../../../shared/world/fog-display";
import { sampleSmooth } from "../../../shared/world/grid-geometry";
import { FOG, ORE, type Ore, type WorldData } from "../../../shared/world/world-data";
import { createBuildingHover } from "../buildings/building-hover";
import { createCrowdLights } from "../three-worker";
import { createDepositSignModel, DEPOSIT_NAMES } from "./deposit-sign-model";
import { createDepositSignPaintings } from "./deposit-sign-painting";

/** Movable survey decorations. Nothing here participates in construction or navigation collision. */
export const createThreeDepositSigns = (
  world: WorldData, materials: Record<BuildingSurface, MeshStandardMaterial>
) => {
  const scene = new Scene();
  const lights = createCrowdLights(scene);
  const hover = createBuildingHover(scene, { local: true, name: "deposit_hover_outline" });
  const signs = new Map<number, { ore: Ore; root: Group }>();
  const paintings = createDepositSignPaintings();
  let revision = "";
  const remove = (id: number) => {
    const sign = signs.get(id);
    if (!sign) return;
    hover.clear();
    sign.root.traverse(object => { if (object instanceof Mesh) object.geometry.dispose(); });
    sign.root.removeFromParent();
    signs.delete(id);
  };
  const sync = (frame: FrameState) => {
    const buildings = frame.buildings ?? [];
    const key = `${world.buildRevision}:${world.terrainRevision}:${frame.roadRevision}:${buildings.length}:${world.mineZones.length}`;
    if (revision === key) return;
    revision = key;
    const active = new Set(world.mineZones.filter(zone => zone.surveyed && zone.ore !== ORE.none).map(zone => zone.id));
    for (const id of signs.keys()) if (!active.has(id)) remove(id);
    const place = createDepositSignPlacement(world, frame.roads ?? [], buildings);
    const occupied: { x: number; z: number }[] = [];
    for (const zone of world.mineZones) {
      if (!active.has(zone.id)) continue;
      if (signs.get(zone.id)?.ore !== zone.ore) remove(zone.id);
      let sign = signs.get(zone.id);
      const previous = sign?.root.visible ? { x: sign.root.position.x, z: sign.root.position.z } : undefined;
      const point = place(zone, previous, occupied);
      if (!point) { if (sign) sign.root.visible = false; continue; }
      if (!sign) {
        const root = createDepositSignModel(materials, paintings.materialFor(zone.ore));
        root.name = `deposit_sign_${zone.id}`;
        root.userData.depositId = zone.id;
        scene.add(root);
        sign = { ore: zone.ore, root };
        signs.set(zone.id, sign);
      }
      sign.root.visible = true;
      sign.root.position.set(point.x, sampleSmooth(world, world.heights, point.x, point.z), point.z);
      occupied.push(point);
    }
  };
  const update = (frame: FrameState) => {
    sync(frame);
    lights(frame.environment);
    for (const { root } of signs.values()) {
      const cell = Math.floor(root.position.z) * world.cellsX + Math.floor(root.position.x);
      // A hidden relocated sign must not reveal a new part of the map.
      root.userData.fogHidden = displayFogAt(world, cell) < FOG.discovered;
    }
  };
  const visibleRoots = () => [...signs.values()].map(sign => sign.root)
    .filter(root => root.visible && !root.userData.fogHidden);
  const pickHit = (raycaster: Raycaster) => {
    scene.updateMatrixWorld(true);
    const hit = raycaster.intersectObjects(visibleRoots(), true).find(hit => hit.object.name !== "deposit_hover_outline");
    if (!hit) return null;
    let root = hit.object;
    while (root.parent && root.userData.depositId === undefined) root = root.parent;
    const id = root.userData.depositId as number;
    const sign = signs.get(id);
    return sign ? { distance: hit.distance, id, label: DEPOSIT_NAMES[sign.ore] ?? "Ore deposit" } : null;
  };
  return {
    update, pickHit,
    setHover: (id: number | null) => hover.set(id === null ? undefined : signs.get(id)?.root),
    render: (renderer: WebGLRenderer, camera: Camera) => {
      for (const { root } of signs.values()) {
        if (!root.visible || !root.userData.fogHidden) continue;
        root.visible = false; root.userData.restoreVisibility = true;
      }
      scene.updateMatrixWorld(true);
      renderer.render(scene, camera);
      for (const { root } of signs.values()) if (root.userData.restoreVisibility) {
        root.visible = true; root.userData.restoreVisibility = false;
      }
    },
    dispose: () => { hover.dispose(); for (const id of signs.keys()) remove(id); paintings.dispose(); }
  };
};
