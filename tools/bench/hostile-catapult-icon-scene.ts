import * as three from "three";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { createNeutralBuilding } from "../../src/renderers/three/buildings/neutral-building";
import { createRomanMaterials } from "../../src/renderers/three/buildings/roman-materials";
import { createThemedNeutralBuildingMaterials } from "../../src/renderers/three/buildings/themed-neutral-building-materials";
import type { HostileCatapultVariant } from "../../src/shared/world/scenario-catapult";

/** Two real source-model thumbnails only: no library or unrelated nation assets are exported. */
export const hostileCatapultIcon = async (variant: HostileCatapultVariant) => {
  const renderer = new three.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(512, 512); renderer.setPixelRatio(1); renderer.toneMapping = three.ACESFilmicToneMapping;
  renderer.setClearColor(0, 0);
  const scene = new three.Scene();
  scene.add(new three.HemisphereLight("#fff5e9", "#647650", 2));
  const sun = new three.DirectionalLight("#fff2d9", 3); sun.position.set(-5, 8, 6); scene.add(sun);
  const base = createRomanMaterials(true);
  const style = { theme: "forest" as const, variant };
  if (variant === "pirate") Object.assign(style, { theme: "tropical" });
  const materials = createThemedNeutralBuildingMaterials(base.materials, style);
  const model = createNeutralBuilding(getBuildingDefinition(16), materials.materials, true, style);
  try {
    model.fitToGrid(); scene.add(model.root);
    model.update(0, { construction: 1, door: 0, working: false, inputStock: { stone: 2 } });
    await new Promise(resolve => setTimeout(resolve, 100));
    const box = new three.Box3().setFromObject(model.root), center = box.getCenter(new three.Vector3());
    const camera = new three.PerspectiveCamera(32, 1, .05, 80);
    const direction = new three.Vector3(.8, .45, 1).normalize();
    let distance = box.getSize(new three.Vector3()).length() * 1.65;
    let framed = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      camera.position.copy(center).addScaledVector(direction, distance);
      camera.lookAt(center); camera.updateMatrixWorld(true);
      framed = true;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const projected = new three.Vector3(x, y, z).project(camera);
          if (Math.abs(projected.x) > .92 || Math.abs(projected.y) > .92) framed = false;
        }
      if (framed) break;
      distance *= 1.08;
    }
    if (!framed) throw new Error("Hostile icon could not fit the complete source model");
    renderer.render(scene, camera); renderer.getContext().finish();
    return { png: renderer.domElement.toDataURL("image/png").split(",")[1]!,
      triangles: renderer.info.render.triangles, calls: renderer.info.render.calls };
  } finally {
    model.dispose(); materials.dispose(); base.dispose(); renderer.dispose();
  }
};
