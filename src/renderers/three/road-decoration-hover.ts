import { Group, Mesh, MeshStandardMaterial, Scene, SRGBColorSpace } from "three";

import type { RoadPlantColour } from "../../render-common/road-plant-catalog";
import type { RoadDecorationFrame } from "../../shared/settlement/road-decoration-state";
import { createBuildingHover } from "./buildings/building-hover";

/** One visible instance proxy; template geometry is borrowed and the shared building outline owns its clones. */
export const createRoadDecorationHover = (parent: Group,
  templateFor: (item: string, uid?: number) => { root: Group; flowerColour?: RoadPlantColour }) => {
  const scene = new Scene(), entries = new Map<string, {
    root: Group; template: Group; hover: ReturnType<typeof createBuildingHover>
  }>();
  let current: Group | undefined, uid: number | null = null, disposed = false;
  const set = (frame?: RoadDecorationFrame) => {
    if (disposed) return false;
    if (!frame) { if (current) current.visible = false; current = undefined; uid = null; return false; }
    let entry = entries.get(frame.item);
    const template = templateFor(frame.item, frame.uid);
    if (entry && entry.template !== template.root) {
      if (current === entry.root) { current = undefined; uid = null; }
      entry.hover.dispose(); entry.root.removeFromParent(); entry.root.clear();
      entries.delete(frame.item); entry = undefined;
    }
    if (!entry) {
      const root = new Group(); root.name = "road_decoration_hover_instance";
      for (const part of template.root.children) if (part instanceof Mesh) {
        const mesh = new Mesh(part.geometry, part.material); mesh.name = part.name; mesh.renderOrder = 1; root.add(mesh);
      }
      const hover = createBuildingHover(scene, { local: true, name: "road_decoration_hover_outline",
        excludeOutline: mesh => ["canonical-plant-overview", "peach-canonical-impostor", "peach-original-crown-masses",
          // Cut-out cards would outline their whole trimmed card, not the leaf.
          "foliage"].includes(mesh.name) });
      entry = { root, template: template.root, hover }; entries.set(frame.item, entry); parent.add(root);
      hover.set(root);
      for (const mesh of root.children) if (mesh instanceof Mesh && mesh.material instanceof MeshStandardMaterial) {
        // Only these private bright proxy clones receive the offset; batched base materials stay untouched.
        mesh.material.polygonOffset = true; mesh.material.polygonOffsetFactor = -1; mesh.material.polygonOffsetUnits = -1;
        if (mesh.name === "paint" && template.flowerColour)
          mesh.material.color.setRGB(...template.flowerColour, SRGBColorSpace).multiplyScalar(1.5);
      }
    }
    if (current !== entry.root && current) current.visible = false;
    current = entry.root; current.visible = true; uid = frame.uid;
    current.position.set(...frame.position); current.rotation.y = frame.yaw;
    entry.hover.set(current);
    return true;
  };
  const retain = (items: ReadonlySet<string>) => {
    for (const [item, entry] of entries) {
      if (items.has(item)) continue;
      if (entry.root === current) set();
      entry.hover.dispose(); entry.root.removeFromParent(); entry.root.clear(); entries.delete(item);
    }
  };
  return { set, retain, statistics: () => ({ uid, templates: entries.size }),
    dispose: () => {
      if (disposed) return;
      set(); disposed = true;
      for (const entry of entries.values()) { entry.hover.dispose(); entry.root.removeFromParent(); entry.root.clear(); }
      entries.clear();
    } };
};
