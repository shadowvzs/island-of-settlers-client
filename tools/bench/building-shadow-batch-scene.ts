import {
  Box3, BoxGeometry, Color, Group, InstancedMesh, Matrix4, Mesh, type MeshBasicMaterial,
  MeshDepthMaterial, MeshStandardMaterial,
  OrthographicCamera, RGBADepthPacking, Scene, Vector3, WebGLRenderer, WebGLRenderTarget
} from "three";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import type { BuildingSurface } from "../../src/render-common/buildings/building-recipe";
import type { WorkerNation } from "../../src/render-common/workers/worker-unit";
import { createBuildingShadowCaster } from "../../src/renderers/three/buildings/building-shadows";
import { createNationBuilding } from "../../src/renderers/three/buildings/nation-building";

/** Historical per-piece reference, used only to compare actual depth pixels against batching. */
const createReference = (source: Group, material: MeshDepthMaterial) => {
  const root = source.clone(true);
  const originals: typeof source.children = [], copies: typeof source.children = [];
  source.traverse(object => originals.push(object));
  root.traverse(object => {
    copies.push(object);
    if (object instanceof Mesh) object.material = material;
  });
  return {
    root,
    update: () => {
      originals.forEach((object, index) => {
        const copy = copies[index]!;
        copy.position.copy(object.position);
        copy.quaternion.copy(object.quaternion);
        copy.scale.copy(object.scale);
        const courses = object.userData.constructionCourses as { height: { value: number } } | undefined;
        copy.visible = object.visible && !(courses && Number.isFinite(courses.height.value));
      });
      root.updateMatrixWorld();
    }
  };
};

const pixelDifference = (reference: Uint8Array, actual: Uint8Array) => {
  let changed = 0, maxDepthDifference = 0;
  // Three's RGBADepthPacking, decoded before comparison: low packed bytes can differ greatly
  // for negligible floating-point depth changes after baking vertices to local space.
  const depth = (pixels: Uint8Array, offset: number) =>
    pixels[offset]! / 256 + pixels[offset + 1]! / 65536 + pixels[offset + 2]! / 16777216 +
    pixels[offset + 3]! / (255 * 16777216);
  for (let pixel = 0; pixel < reference.length; pixel += 4) {
    const delta = Math.abs(depth(reference, pixel) - depth(actual, pixel));
    if (delta > 0.000002) changed++;
    maxDepthDifference = Math.max(maxDepthDifference, delta);
  }
  return { changedFraction: changed / (reference.length / 4), maxDepthDifference };
};

export const reviewBuildingShadows = async () => {
  const renderer = new WebGLRenderer({ antialias: false });
  renderer.setSize(640, 640);
  document.body.append(renderer.domElement);
  const gpu = renderer.getContext().getExtension("WEBGL_debug_renderer_info");
  const gpuName = gpu ? renderer.getContext().getParameter(gpu.UNMASKED_RENDERER_WEBGL) : "unknown";
  const target = new WebGLRenderTarget(640, 640);
  const referenceScene = new Scene(), batchScene = new Scene();
  referenceScene.background = new Color(0xffffff);
  batchScene.background = new Color(0xffffff);
  const material = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  const surface = new MeshStandardMaterial();
  const materials = new Proxy({} as Record<BuildingSurface, MeshStandardMaterial>, {
    get: () => surface
  });
  const camera = new OrthographicCamera(-8, 8, 8, -8, .1, 100);
  const a = new Uint8Array(640 * 640 * 4), b = new Uint8Array(a.length);
  const results: Record<string, unknown>[] = [];
  const ownedBytes = (root: Group) => {
    let bytes = 0;
    root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const geometry = object.geometry;
      bytes += geometry.getAttribute("position").array.byteLength;
      bytes += geometry.index?.array.byteLength ?? 0;
    });
    return bytes;
  };
  const render = (scene: Scene, pixels: Uint8Array) => {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const result = { draws: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    renderer.readRenderTargetPixels(target, 0, 0, 640, 640, pixels);
    return result;
  };
  const nations: WorkerNation[] = ["roman", "viking", "japanese", "nubian"];
  for (const detailed of [true, false]) {
    for (const nation of nations) {
      for (const id of [0, 17, 35]) {
        const model = createNationBuilding(getBuildingDefinition(id), materials, nation, detailed);
        model.fitToGrid();
        model.root.position.set(3, 1, -2);
        model.root.rotation.y = .63;
        const reference = createReference(model.root, material);
        // Production uses BasicMaterial. DepthMaterial has the same position path; it exposes
        // packed depth pixels here, catching depth errors as well as silhouette differences.
        const batch = createBuildingShadowCaster(model.root, material as unknown as MeshBasicMaterial);
        referenceScene.add(reference.root);
        batchScene.add(batch.root);
        for (const [label, time, construction, door] of [
          ["built", 0, 1, 0], ["moving", 1.4, 1, 1], ["construction", 2.7, .3, 0]
        ] as const) {
          model.update(time, { construction, working: true, door, windStrength: 1.1, windDirection: .5 });
          model.root.updateMatrixWorld(true);
          reference.update();
          batch.update();
          const bounds = new Box3().setFromObject(model.root);
          const center = bounds.getCenter(new Vector3());
          camera.position.copy(center).add(new Vector3(14, 22, 18));
          camera.lookAt(center);
          const before = render(referenceScene, a), after = render(batchScene, b);
          results.push({ nation, detailed, id, label, before, after,
            ownedBytes: ownedBytes(batch.root), ...pixelDifference(a, b) });
        }
        reference.root.removeFromParent();
        batch.dispose();
        model.dispose();
      }
    }
  }
  const instanceGeometry = new BoxGeometry();
  const instanceSource = new Group();
  const instances = new InstancedMesh(instanceGeometry, material, 2);
  instances.setMatrixAt(1, new Matrix4().makeTranslation(3, 0, 0));
  instanceSource.add(instances);
  const instanceReference = createReference(instanceSource, material);
  const instanceBatch = createBuildingShadowCaster(instanceSource, material as unknown as MeshBasicMaterial);
  referenceScene.add(instanceReference.root);
  batchScene.add(instanceBatch.root);
  instanceReference.update();
  instanceBatch.update();
  camera.position.set(14, 22, 18);
  camera.lookAt(0, 0, 0);
  results.push({ label: "specialized-instance-fallback", before: render(referenceScene, a),
    after: render(batchScene, b), ...pixelDifference(a, b) });
  (instanceReference.root.children[0] as InstancedMesh).dispose();
  instanceReference.root.removeFromParent();
  instanceBatch.dispose();
  instances.dispose();
  instanceGeometry.dispose();
  // Repeated actual GPU upload/disposal, not only an owner counter.
  const released: number[] = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    const model = createNationBuilding(getBuildingDefinition(17), materials, "roman", true);
    model.update(cycle, { construction: 1, working: true, door: 0 });
    const batch = createBuildingShadowCaster(model.root, material as unknown as MeshBasicMaterial);
    batchScene.add(batch.root);
    batch.update();
    render(batchScene, b);
    batch.dispose();
    model.dispose();
    renderer.render(batchScene, camera);
    released.push(renderer.info.memory.geometries);
  }
  renderer.setRenderTarget(null);
  const finalMemory = { ...renderer.info.memory };
  surface.dispose();
  material.dispose();
  target.dispose();
  renderer.dispose();
  return { gpu: gpuName, results, released, finalMemory };
};
