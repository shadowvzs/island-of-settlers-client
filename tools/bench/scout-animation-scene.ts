import { spyglassGrip } from "@workers/worker-spyglass";
import * as three from "three";

import { computeEnvironment } from "../../src/render-common/environment";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import type { WorkerFrame } from "../../src/render-common/workers/worker-unit";
import { createThreeWorkerCrowd, createWorkerTextureLoader } from "../../src/renderers/three/three-worker";

/** Real exported Tripo worker, game crowd/prop placement, and canonical game Spyglass. */
export const runScoutAnimationReview = async (detailed: boolean) => {
  const renderer = new three.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(640, 640); renderer.setPixelRatio(1);
  renderer.setClearColor(0x939c8e); renderer.autoClear = false;
  document.body.append(renderer.domElement);
  const textures = createWorkerTextureLoader(renderer);
  const crowd = await createThreeWorkerCrowd(textures, [], detailed);
  const environment = computeEnvironment({ azimuthX: -.6, azimuthZ: .8, elevation: .85 }, 12, 0);
  const camera = new three.PerspectiveCamera(30, 1, .01, 100);
  const scenes = new Set<three.Scene>();
  const originalRender = renderer.render.bind(renderer);
  renderer.render = (scene, view) => { scenes.add(scene as three.Scene); originalRender(scene, view); };
  const frame = {
    actorId: 1, nation: "roman", variant: "roman-man-white", x: 0, y: 0, z: 0,
    heading: 0, selected: false, visible: true, action: "spyglass_scan", gaitPhase: 0,
    runBlend: 0, animationTime: 0, target: null, workerJob: "Scout", workerTool: "spyglass",
    carryingWare: null
  } as WorkerFrame;
  camera.position.set(-1.1, .9, 1.5).multiplyScalar(WORKER_SCALE);
  camera.lookAt(0, .72 * WORKER_SCALE, .12 * WORKER_SCALE);
  const draw = () => { crowd.update([frame], environment); renderer.clear(); crowd.render(renderer, camera); };
  const settle = async () => {
    for (let tick = 0; tick < 300; tick++) {
      draw();
      if (crowd.poolStats().instances && tick >= 20) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error("Scout worker body did not load");
  };
  const sheet = document.createElement("canvas"); sheet.width = 1280; sheet.height = 1280;
  const context = sheet.getContext("2d")!;
  const metrics: unknown[] = [];
  for (const [index, time] of [0, .4, .88, 1.44, 2, 2.56, 3.12, 4].entries()) {
    frame.animationTime = time; await settle();
    context.drawImage(renderer.domElement, index % 4 * 320, Math.floor(index / 4) * 320, 320, 320);
    camera.position.x *= -1; camera.lookAt(0, .72 * WORKER_SCALE, .12 * WORKER_SCALE); draw();
    context.drawImage(renderer.domElement, index % 4 * 320, 640 + Math.floor(index / 4) * 320, 320, 320);
    camera.position.x *= -1; camera.lookAt(0, .72 * WORKER_SCALE, .12 * WORKER_SCALE);
    context.fillStyle = "white"; context.font = "16px sans-serif";
    context.fillText(`${time.toFixed(2)}s`, index % 4 * 320 + 8, Math.floor(index / 4) * 320 + 22);
    const objects: three.Object3D[] = [];
    for (const scene of scenes) scene.traverse(object => {
      if (object.name === "head" || object.name === "ware_spyglass" || object.name === "socket_hand_L" || object.name === "socket_hand_R")
        objects.push(object);
    });
    const prop = objects.find(object => object.name === "ware_spyglass");
    if (!prop) throw new Error("Scout scan must retain the actual game Spyglass");
    const contacts = ["L", "R"].map(side => {
      const hand = objects.find(object => object.name === `socket_hand_${side}`);
      if (!hand) throw new Error(`Scout hand alias missing: ${side}`);
      const target = prop.localToWorld(new three.Vector3(...spyglassGrip(side)));
      return { side, error: target.distanceTo(hand.getWorldPosition(new three.Vector3())) / WORKER_SCALE };
    });
    if (contacts.some(contact => contact.error > .02))
      throw new Error(`Scout actual game tool hand contact failed at ${time}s`);
    metrics.push({ time, contacts, objects: objects.map(object => ({ name: object.name,
      position: object.getWorldPosition(new three.Vector3()).toArray() })) });
  }
  crowd.dispose(); textures.dispose(); renderer.dispose();
  return { metrics, png: sheet.toDataURL("image/png").split(",")[1]! };
};
