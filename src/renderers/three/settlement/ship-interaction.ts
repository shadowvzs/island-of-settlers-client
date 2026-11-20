import { Mesh, type Object3D, type Raycaster, type Scene } from "three";

import { createBuildingHover } from "../buildings/building-hover";

const shipRoot = (object: Object3D, group: Object3D): Object3D | undefined => {
  let root = object;
  while (root.parent && root.parent !== group) root = root.parent;
  return root.parent === group && root.name.startsWith("ship-") ? root : undefined;
};

/** Only completed vessels can be selected; the outline moves with the vessel's local frame. */
export const createShipInteraction = (scene: Scene, group: Object3D) => {
  const hover = createBuildingHover(scene, {
    local: true,
    name: "ship_hover_outline",
    excludeOutline: mesh => {
      let parent: Object3D | null = mesh;
      while (parent && parent !== group) {
        if (parent.name === "ship_cargo") return true;
        parent = parent.parent;
      }
      // The sail geometry changes with wind. Brighten it without freezing its silhouette.
      return mesh.name === "ship_sail" || mesh.name === "ship_flag";
    }
  });
  const pickHit = (raycaster: Raycaster) => {
    const meshes: Mesh[] = [];
    group.traverseVisible(object => {
      if (object instanceof Mesh && object.name !== "ship_hover_outline" && shipRoot(object, group))
        meshes.push(object);
    });
    const hit = raycaster.intersectObjects(meshes, false)[0];
    const root = hit && shipRoot(hit.object, group);
    return hit && root ? { id: root.name.slice(5), distance: hit.distance } : null;
  };
  return {
    pickHit,
    pick: (raycaster: Raycaster) => pickHit(raycaster)?.id ?? null,
    setHover: (id: string | null) => hover.set(id === null ? undefined :
      group.children.find(root => root.name === `ship-${id}`)),
    getStats: hover.getStats,
    dispose: hover.dispose
  };
};
