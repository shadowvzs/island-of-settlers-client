import type { GalleryCase, GalleryView } from "./building-gallery-plan";

export interface GalleryImage { view: GalleryView; encoded: string }
export interface GalleryRender {
  images: GalleryImage[]; triangles: number; residentTriangles: number; residentMeshes: number;
  parts: number; floorHides: number; windowParts: number; budget: number; withinBudget: boolean;
  memory: { geometries: number; textures: number }; milliseconds: number;
}

/** Serialized directly into the showcase page; all runtime imports stay inside the function. */
export const renderGalleryCase = async ({ entry, views }: { entry: GalleryCase; views: readonly GalleryView[] }): Promise<GalleryRender> => {
  const start = performance.now(), preview = (window as any).__buildingPreview;
  const three = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
  const { nationTriangleBudget } = await import(
    /* @vite-ignore */ String("/src/render-common/buildings/building-triangle-budgets.ts"));
  preview.renderer.setAnimationLoop(null);
  preview.controls.enabled = false;
  // Each upgrade comparison uses the complete level-5 envelope, including resident assets.
  const referenceKey = `${entry.id}`;
  const frameCache = (window as any).__galleryFrames ??= new Map();
  if (!frameCache.has(referenceKey)) {
    preview.selectBuilding(entry.id, 5);
    await (window as any).__buildingResidentReady;
    preview.model().update(0, { construction: 1, door: 0, working: false, windStrength: .6, windDirection: .4 });
    preview.model().root.updateMatrixWorld(true);
    const box = new three.Box3().setFromObject(preview.model().root);
    frameCache.set(referenceKey, { min: box.min.toArray(), max: box.max.toArray() });
  }
  preview.selectBuilding(entry.id, entry.level);
  await (window as any).__buildingResidentReady;
  const model = preview.model();
  model.update(0, { construction: 1, door: 0, working: false, windStrength: .6, windDirection: .4 });
  model.root.rotation.y = 0;
  model.root.updateMatrixWorld(true);
  const deadline = performance.now() + 15_000;
  for (;;) {
    let waiting = false;
    model.root.traverse((object: any) => {
      if (!object.isMesh) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        for (const map of [material.map, material.normalMap]) if (map && !map.image?.width) waiting = true;
    });
    if (!waiting) break;
    if (performance.now() > deadline) throw new Error("Actual model texture did not become resident");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const frame = frameCache.get(referenceKey), box = new three.Box3(
    new three.Vector3(...frame.min), new three.Vector3(...frame.max));
  const centre = box.getCenter(new three.Vector3()), size = box.getSize(new three.Vector3());
  const camera = preview.camera.clone();
  camera.aspect = 768 / 640;
  const vertical = camera.fov * Math.PI / 360;
  const halfFov = Math.min(vertical, Math.atan(Math.tan(vertical) * camera.aspect));
  const distance = size.length() / 2 / Math.sin(halfFov) * 1.08;
  camera.far = Math.max(160, distance * 4);
  camera.updateProjectionMatrix();
  let residentMeshes = 0, residentTriangles = 0;
  model.root.traverse((object: any) => {
    if (!object.isMesh) return;
    for (let ancestor = object; ancestor; ancestor = ancestor.parent) if (!ancestor.visible) return;
    const available = object.geometry.index?.count ?? object.geometry.getAttribute("position")?.count ?? 0;
    const count = Math.max(0, Math.min(available - object.geometry.drawRange.start, object.geometry.drawRange.count));
    if (count > 0) { residentMeshes++; residentTriangles += count / 3; }
  });
  if (!residentMeshes || !residentTriangles) throw new Error("Empty canonical resident model");
  const images: GalleryImage[] = [];
  for (const view of views) {
    let direction = new three.Vector3(4.5, 3.2, 5.5).normalize();
    preview.renderer.clippingPlanes = [];
    if (view === "rear") direction = new three.Vector3(-4.5, 3.2, -5.5).normalize();
    if (view === "interior") {
      direction = new three.Vector3(1, 1.8, 1.25).normalize();
      preview.renderer.clippingPlanes = [new three.Plane(new three.Vector3(0, -1, 0), box.min.y + size.y * .25)];
    }
    camera.position.copy(centre).addScaledVector(direction, distance);
    camera.lookAt(centre);
    camera.updateMatrixWorld(true);
    preview.renderer.render(preview.scene, camera);
    images.push({ view, encoded: preview.renderer.domElement.toDataURL("image/jpeg", .9).split(",")[1] });
  }
  preview.renderer.clippingPlanes = [];
  const triangles = model.triangles(false), budget = nationTriangleBudget(entry.nation, entry.id)[entry.quality === "high" ? 0 : 1];
  const parts = model.recipe?.parts ?? [];
  return { images, triangles, budget, withinBudget: triangles <= budget, residentMeshes, residentTriangles,
    parts: parts.length, floorHides: parts.filter((part: any) => part.shape === "indigenous-floor-hide").length,
    windowParts: parts.filter((part: any) => part.windowShadow).length,
    memory: { ...preview.renderer.info.memory }, milliseconds: performance.now() - start };
};

/** 2D-only contact sheet assembly in the same browser; no second renderer/context or asset export. */
export const renderGallerySheet = async (tiles: { encoded: string; label: string }[]) => {
  const canvas = document.createElement("canvas");
  canvas.width = 1280; canvas.height = Math.ceil(tiles.length / 4) * 294;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#242a23"; context.fillRect(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < tiles.length; index++) {
    const tile = tiles[index]!, image = new Image();
    image.src = `data:image/jpeg;base64,${tile.encoded}`;
    await image.decode();
    const x = index % 4 * 320, y = Math.floor(index / 4) * 294;
    context.drawImage(image, x, y, 320, 267);
    context.fillStyle = "white"; context.font = "13px sans-serif";
    context.fillText(tile.label, x + 5, y + 285, 310);
  }
  return canvas.toDataURL("image/jpeg", .9).split(",")[1]!;
};
