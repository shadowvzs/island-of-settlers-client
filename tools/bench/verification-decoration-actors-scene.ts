import { MOUNT_CLIPS } from "@workers/mount-clips";
import * as three from "three";

import { ROAD_DECORATION_ITEM_DEFINITIONS } from "../../../island-of-settlers-shared/src/road-decoration-items";
import { PLANT_COMPLETION_ITEM_IDS, plantCompletionModelFamily } from "../../../island-of-settlers-shared/src/road-plant-completion";
import { computeEnvironment } from "../../src/render-common/environment";
import { CART_STONE_LANE, cartCapacityFor } from "../../src/render-common/logistics/handcart-rules";
import type { MountFrame } from "../../src/render-common/mounts/mount-frame";
import { NATION_RIDERS } from "../../src/render-common/mounts/nation-riders";
import type { WorkerNation } from "../../src/render-common/workers/worker-unit";
import { createDecorationAssetLoader } from "../../src/renderers/three/road-decoration-asset-loader";
import { createHandcartPrototype } from "../../src/renderers/three/settlement/handcart-prototype";
import { createThreeMounts } from "../../src/renderers/three/three-mounts";
import { createWorkerTextureLoader } from "../../src/renderers/three/three-worker";
import { COMMANDER_DEFINITIONS } from "../../src/shared/settlement/settlement-commander";

const origin = new three.Vector3(20, 0, 30);
const representatives = [...new Map(PLANT_COMPLETION_ITEM_IDS.map(id =>
  [plantCompletionModelFamily(ROAD_DECORATION_ITEM_DEFINITIONS[id]!.plant!), id])).values()];

/** Exact animated/skinned visible vertices; ignores only the explicitly nonphysical ground aura. */
const physicalBounds = (root: three.Object3D) => {
  root.updateMatrixWorld(true);
  const bounds = new three.Box3(), point = new three.Vector3();
  const equipment: string[] = [];
  let vertices = 0;
  root.traverse(object => {
    for (let parent: three.Object3D | null = object; parent; parent = parent.parent) {
      if (!parent.visible || parent.name === "commander_aura") return;
    }
    if (object.name.startsWith("military_") || object.name === "commander_insignia") equipment.push(object.name);
    if (!(object instanceof three.Mesh)) return;
    if (object instanceof three.SkinnedMesh) object.skeleton.update();
    const positions = object.geometry.getAttribute("position");
    for (let index = 0; index < positions.count; index++) {
      object.getVertexPosition(index, point).applyMatrix4(object.matrixWorld).sub(origin);
      bounds.expandByPoint(point); vertices++;
    }
  });
  return { equipment, max: bounds.max.toArray(), min: bounds.min.toArray(), vertices };
};

/** Production actors and cargo; bounded animation samples, not an autonomous pathfinding benchmark. */
export const createDecorationActorScene = async (detailed: boolean) => {
  const renderer = new three.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(1100, 850);
  renderer.toneMapping = three.ACESFilmicToneMapping;
  document.body.append(renderer.domElement);
  const textures = createWorkerTextureLoader(renderer);
  const environment = computeEnvironment({ azimuthX: -.6, azimuthZ: .8, elevation: .85 }, 12, 0);
  const mounts = await createThreeMounts(textures, [], detailed);
  const cart = await createHandcartPrototype(textures, detailed);
  const scene = mounts.scene;
  scene.background = new three.Color("#a8bd99");
  scene.add(cart.root);
  const ground = new three.Mesh(new three.PlaneGeometry(40, 40),
    new three.MeshStandardMaterial({ color: "#89956a", roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.copy(origin); ground.position.y = -.01;
  const paving = new three.Mesh(new three.PlaneGeometry(1.3, 24),
    new three.MeshStandardMaterial({ color: "#aba28e", roughness: 1 }));
  paving.rotation.x = -Math.PI / 2; paving.position.copy(origin); paving.position.y = .002;
  scene.add(ground, paving);
  const camera = new three.PerspectiveCamera(35, 1100 / 850, .01, 300);
  camera.position.copy(origin).add(new three.Vector3(7, 5, 8));
  camera.lookAt(origin.clone().add(new three.Vector3(0, .8, 0))); camera.updateMatrixWorld(true);
  const gl = renderer.getContext(), debug = gl.getExtension("WEBGL_debug_renderer_info");
  const gpu = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const frameFor = (nation: WorkerNation): MountFrame => ({
    actorId: Object.keys(NATION_RIDERS).indexOf(nation) + 1, attackProgress: null,
    auraActive: false, clip: "walk", clipTime: 0, coat: "bay", commander: true,
    commanderLoadout: COMMANDER_DEFINITIONS[nation].loadout, faction: 0, heading: 0, nation,
    rider: NATION_RIDERS[nation], turnRate: 0, x: origin.x, y: 0, z: origin.z });
  const mounted: unknown[] = [], carts: unknown[] = [];
  let activeFrame = frameFor("roman");
  const measure = async () => {
    cart.root.visible = false;
    for (const nation of Object.keys(NATION_RIDERS) as WorkerNation[]) {
      activeFrame = frameFor(nation);
      await mounts.prepare([activeFrame], environment);
      for (const clip of ["idle", "walk", "trot", "gallop"] as const) for (let phase = 0; phase < 8; phase++) {
        activeFrame.clip = clip; activeFrame.clipTime = MOUNT_CLIPS[clip].duration * phase / 8;
        mounts.update([activeFrame], environment);
        const bounds = physicalBounds(scene);
        if (!bounds.equipment.includes(`military_${activeFrame.commanderLoadout}`) ||
          !bounds.equipment.includes("commander_insignia")) throw new Error(`Missing actual equipment for ${nation}`);
        mounted.push({ nation, clip, phase, ...bounds });
      }
    }
    mounts.update([], environment); cart.root.visible = true;
    // Every canonical cart cargo family is checked at full base load, not just the empty bed.
    for (const ware of ["logs", "planks", "stone", "wine", "grain", "spyglass"]) {
      cart.setLoad(Array.from({ length: cartCapacityFor(ware) }, () => ware));
      for (let phase = 0; phase < 16; phase++) {
        cart.update(origin.x + CART_STONE_LANE, 0, origin.z + phase * .07, 0, .05);
        carts.push({ ware, phase, contactError: cart.contactError(), ...physicalBounds(cart.root) });
      }
    }
    return { carts, detailed, gpu, mounted };
  };
  const load = createDecorationAssetLoader(() => { throw new Error("Botanical material ownership changed"); }, detailed);
  const capture = async (index: number, lateralOffset: number) => {
    const item = representatives[index]!;
    const model = await load(item, `passage-${index}`, () => true, "near");
    if (!model) throw new Error(`Missing actual botanical model ${item}`);
    model.root.position.copy(origin).add(new three.Vector3(lateralOffset, 0, 0));
    scene.add(model.root);
    cart.root.visible = true; cart.setLoad(Array.from({ length: cartCapacityFor("wine") }, () => "wine"));
    const frames: { phase: number; png: string }[] = [];
    activeFrame = frameFor(index % 2 ? "viking" : "roman");
    for (const phase of [-1, 0, 1]) {
      activeFrame.z = origin.z + phase; activeFrame.clipTime = (phase + 1) / 3;
      await mounts.prepare([activeFrame], environment);
      cart.update(origin.x - CART_STONE_LANE, 0, origin.z - phase - 3, Math.PI, .1);
      renderer.render(scene, camera);
      frames.push({ phase, png: renderer.domElement.toDataURL("image/png").split(",")[1]! });
    }
    model.dispose(); model.root.removeFromParent();
    return { frames, item };
  };
  const dispose = () => {
    cart.dispose(); mounts.dispose(); textures.dispose();
    ground.geometry.dispose(); (ground.material as three.Material).dispose();
    paving.geometry.dispose(); (paving.material as three.Material).dispose();
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  };
  // Ground/road are deliberately excluded from the physical actor measurement.
  ground.visible = false; paving.visible = false;
  return { capture: async (index: number, offset: number) => {
    ground.visible = true; paving.visible = true;
    return capture(index, offset);
  }, dispose, measure };
};
