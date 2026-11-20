import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AnimationMixer, Bone, Group, Object3D, Vector3 } from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { afterAll, expect, it, vi } from "vitest";

vi.hoisted(() => vi.stubGlobal("document", { baseURI: "http://localhost/" }));
afterAll(() => vi.unstubAllGlobals());

import { WORKER_SCALE } from "../src/render-common/workers/worker-dimensions";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import { createWareModel } from "../src/renderers/three/settlement/ware-models";
import { createWorkerPoser } from "../src/renderers/three/three-worker";
import { placeCarriedCoinCargo } from "../src/renderers/three/worker-coin-cargo";
import { createCradledWareHandContacts } from "../src/renderers/three/worker-stone-carry";

interface Node {
  children?: number[]; matrix?: number[]; name?: string; rotation?: number[]; scale?: number[]; translation?: number[];
}
const folder = resolve(import.meta.dirname, "../../island-of-settlers-worker-generation/game_ready/tripo");
const manifest = JSON.parse(readFileSync(resolve(folder, "manifest.json"), "utf8"));
const entry = manifest.workers.find((worker: { variant: string }) => worker.variant === "roman-man-white");
const rig = () => {
  const bytes = readFileSync(resolve(folder, entry.model));
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
  const joints = new Set<number>(json.skins.flatMap((skin: { joints: number[] }) => skin.joints));
  const nodes: Object3D[] = json.nodes.map((node: Node, index: number) => {
    const object = joints.has(index) ? new Bone() : new Object3D(); object.name = node.name ?? "";
    if (node.matrix) { object.matrix.fromArray(node.matrix); object.matrix.decompose(object.position, object.quaternion, object.scale); }
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
    return object;
  });
  json.nodes.forEach((node: Node, index: number) => node.children?.forEach(child => nodes[index]!.add(nodes[child]!)));
  const root = new Group();
  json.scenes[json.scene ?? 0].nodes.forEach((index: number) => root.add(nodes[index]!));
  root.scale.setScalar(WORKER_SCALE); return root;
};
const readClips = async (path: string) => {
  const bytes = readFileSync(resolve(folder, path));
  return (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "")).animations;
};

it.each(["coinChest", "coinChestStack"])("keeps the original Roman palms on %s through the walking gait", async visual => {
  const root = rig(), clips = [...new Map([...(await readClips(entry.animations)),
    ...(entry.animationOverrides ? await readClips(entry.animationOverrides) : [])].map(clip => [clip.name, clip])).values()];
  const pose = createWorkerPoser({ root, clips, mixer: new AnimationMixer(root), entry,
    dispose: () => {}, setTeamColor: () => {} });
  const load = createWareModel(visual, true, {} as Parameters<typeof createWareModel>[2], "carry");
  root.add(load.root);
  const contacts = createCradledWareHandContacts(root);
  const frame: WorkerFrame = { nation: "roman", variant: "roman-man-white", action: "carry_shoulder",
    animationTime: .3, gaitPhase: 0, runBlend: 0, heading: 0, x: 0, y: 0, z: 0, target: null,
    workerJob: "Carrier", selected: false, carryingWare: visual, visible: true };
  for (let phase = 0; phase < 1; phase += .125) {
    frame.gaitPhase = phase;
    pose(frame); placeCarriedCoinCargo(load.root); root.updateMatrixWorld(true);
    contacts(load.root, { direction: "pickup", ware: visual, progress: 1, target: frame }, true);
    root.updateMatrixWorld(true);
    const values = ["Left", "Right"].map(side => {
      const socket = root.getObjectByName(`socket_hand_${side === "Left" ? "L" : "R"}`)!;
      const upper = root.getObjectByName(`${side}Arm`)!, lower = root.getObjectByName(`${side}ForeArm`)!;
      const hand = root.getObjectByName(`${side}Hand`)!;
      const target = new Vector3().fromArray(load.root.userData[`stoneSupport${side}`]);
      const shoulder = upper.getWorldPosition(new Vector3()), elbow = lower.getWorldPosition(new Vector3());
      return { side, error: socket.getWorldPosition(new Vector3()).distanceTo(target), target: target.toArray(),
        shoulder: shoulder.toArray(), reach: shoulder.distanceTo(elbow) + elbow.distanceTo(hand.getWorldPosition(new Vector3())),
        distance: shoulder.distanceTo(target) };
    });
    expect(values.every(value => value.error < .015), JSON.stringify({ phase, values })).toBe(true);
  }
  load.dispose();
});
