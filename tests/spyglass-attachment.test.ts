import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AnimationMixer, Group, Object3D, Vector3 } from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";

import { SPYGLASS_EYE_LENS_Y, SPYGLASS_TOOL_SCALE } from "../src/render-common/wares/spyglass-parts";
import { PLAYER_AVATAR_BODIES } from "../src/render-common/workers/player-avatar";
import { createExplorationSpyglassAttachment } from "../src/renderers/three/exploration/spyglass-attachment";

const folder = resolve(import.meta.dirname, "../../island-of-settlers-worker-generation/game_ready/tripo");
const manifest = JSON.parse(readFileSync(resolve(folder, "manifest.json"), "utf8"));
const glb = (path: string) => {
  const bytes = readFileSync(resolve(folder, path));
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + length));
  const binary = bytes.subarray(28 + length);
  return { binary, json };
};
const readRig = (path: string) => {
  const { json } = glb(path), root = new Group();
  const nodes: Object3D[] = json.nodes.map((node: any) => {
    const object = new Object3D(); object.name = node.name ?? "";
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
    return object;
  });
  json.nodes.forEach((node: any, index: number) => node.children?.forEach((child: number) => nodes[index]!.add(nodes[child]!)));
  json.scenes[json.scene ?? 0].nodes.forEach((node: number) => root.add(nodes[node]!));
  return root;
};
const readIdle = async (path: string) => {
  const bytes = readFileSync(resolve(folder, path));
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  return gltf.animations.find(clip => clip.name === "idle_breathe")!;
};

const bodies = Object.entries(PLAYER_AVATAR_BODIES).flatMap(([nation, genders]) =>
  Object.entries(genders).map(([gender, body]) => ({ gender, nation, variant: body.variant })));

describe("possessed explorer holds the telescope in its animated palms", () => {
  it.each(bodies)("keeps both grips and the eyecup on the real $nation $gender rig", async ({ variant }) => {
    const record = manifest.workers.find((entry: any) => entry.variant === variant);
    expect(record, variant).toBeDefined();
    const root = readRig(record.model), parent = new Group(), tool = new Group();
    parent.position.set(7, 3, -4); parent.rotation.y = .7; parent.add(root);
    root.scale.setScalar(.87); tool.scale.setScalar(SPYGLASS_TOOL_SCALE);
    const mixer = new AnimationMixer(root), clip = await readIdle(record.animations);
    mixer.clipAction(clip).play();
    const attachment = createExplorationSpyglassAttachment(root, tool);
    expect(attachment.attached()).toBe(true);
    for (const seconds of [0, .4, 1.3]) {
      attachment.reset(); mixer.setTime(seconds); attachment.apply(false); root.updateWorldMatrix(true, true);
      const contact = attachment.contacts(), carry = tool.localToWorld(new Vector3(0, .065, 0));
      expect(carry.distanceTo(contact.right!.getWorldPosition(new Vector3())), `${variant}: carry grip`).toBeLessThan(1e-7);
      attachment.reset(); mixer.setTime(seconds);
      const base = root.getObjectByName("RightArm")!.quaternion.clone();
      attachment.apply(true); root.updateWorldMatrix(true, true);
      const raised = attachment.contacts();
      const right = tool.localToWorld(raised.rightGrip.clone()), left = tool.localToWorld(raised.leftGrip.clone());
      const errors = { right: right.distanceTo(contact.right!.getWorldPosition(new Vector3())),
        left: left.distanceTo(contact.left!.getWorldPosition(new Vector3())),
        eye: tool.localToWorld(new Vector3(0, SPYGLASS_EYE_LENS_Y, 0)).distanceTo(attachment.contacts().eye) };
      expect(errors.right, `${variant}: right grip`).toBeLessThan(1e-7);
      expect(errors.left, `${variant}: left grip`).toBeLessThan(.005);
      expect(errors.eye, `${variant}: eyecup`).toBeLessThan(.02);
      attachment.reset();
      expect(root.getObjectByName("RightArm")!.quaternion.toArray()).toEqual(base.toArray());
    }
  });

  it("hides a tool whose body has no hand socket instead of attaching at an estimated root offset", () => {
    const root = new Group(), tool = new Group(); root.add(tool);
    const attachment = createExplorationSpyglassAttachment(root, tool);
    expect(attachment.attached()).toBe(false);
    expect(attachment.apply(false)).toBe(false);
    expect(tool.visible).toBe(false);
    expect(tool.parent).toBeNull();
  });
});
