import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AnimationMixer, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { expect, it } from "vitest";

import { VIKING_AXE_GRIP_RADIUS } from "../src/render-common/workers/viking-axe";
import grips from "../src/render-common/workers/viking-foot-axe-grips.json";
import { WORKER_SCALE } from "../src/render-common/workers/worker-dimensions";
import { buildTwoHanded } from "../src/renderers/three/military-equipment-two-handed";
import { createUnitEyeOffset } from "../src/renderers/three/unit-eye-offset";
import { createWorkerCombatPose } from "../src/renderers/three/worker-combat-pose";
import { createWorkerMilitaryPlacement } from "../src/renderers/three/worker-military-placement";
import { readCpuGltf } from "../tools/assets/read-cpu-gltf";

const verified = new Set<string>();

it.each(["viking-woman-blue", "viking-woman-boots", "viking-woman-dark", "viking-man-blond", "viking-man-olive", "viking-man-red"]
  .flatMap(variant => [0, 1].flatMap(combatVariant => ["idle_breathe", "walk", "run"].flatMap(action =>
    [.1, .4, .7, .8].map(time => ({ action, combatVariant, time, variant }))))))(
  "keeps the real $variant $combatVariant $action $time parry in the FPS viewport", async ({ action, combatVariant, time, variant }) => {
    const folder = resolve(`../island-of-settlers-worker-generation/game_ready/tripo/${variant}`);
    const profile = grips.profiles.find(profile => profile.variant === variant)!;
    if (!verified.has(variant)) {
      const hash = (name: string) => createHash("sha256").update(readFileSync(resolve(folder, name))).digest("hex");
      expect(hash("model.glb")).toBe(profile.sourceSha256); expect(hash("actions.glb")).toBe(profile.actionsSha256);
      verified.add(variant);
    }
    const { scene: body } = await readCpuGltf(resolve(folder, "model.glb"));
    const { animations } = await readCpuGltf(resolve(folder, "actions.glb"));
    const root = new Group(); root.scale.setScalar(WORKER_SCALE); root.add(body);
    const mixer = new AnimationMixer(body), idle = animations.find(clip => clip.name === action)!;
    expect(idle).toBeDefined(); mixer.clipAction(idle).play(); mixer.setTime(time);
    const originals = new Map<string, number[]>();
    body.traverse(bone => { if (/^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)[123]$/.test(bone.name)) originals.set(bone.name, bone.quaternion.toArray()); });
    const pose = createWorkerCombatPose(body, animations);
    const frame = { nation: "viking", action, variant, combat: {
      attackProgress: null, defending: true, faction: 0, manualGuard: true, type: "heavy", variant: combatVariant
    } } as never;
    const segments = ["Left", "Right"].flatMap(side => ["Arm", "ForeArm", "Hand"].map(part => {
      const bone = body.getObjectByName(`${side}${part}`)!; return { bone, position: bone.position.toArray() };
    }));
    pose.apply(frame);
    const joints = new Map<string, import("three").Object3D>(); body.traverse(joint => joints.set(joint.name, joint));
    const prop = new Group(), axe = new Mesh(buildTwoHanded("viking", false), new MeshBasicMaterial()); prop.add(axe); body.add(prop);
    prop.userData.meleeAxes = { blade: new Vector3(0, 1, 0), edge: new Vector3(1, 0, 0) };
    // Exact standing production contract: three-worker-prop keeps props under root and writes
    // root-space hand transforms on EVERY frame. Reparenting would double-transform frame two.
    const place = createWorkerMilitaryPlacement(body, joints, (object, side) => {
      const hand = joints.get(`socket_hand_${side}`)!; body.updateMatrixWorld(true);
      object.position.copy(body.worldToLocal(hand.getWorldPosition(new Vector3())));
      object.quaternion.copy(body.getWorldQuaternion(new Quaternion()).invert().multiply(hand.getWorldQuaternion(new Quaternion())));
    });
    for (let sample = 0; sample < 2; sample++) { place(prop, frame, "axe"); expect(prop.parent).toBe(body); root.updateMatrixWorld(true); }
    const eye = createUnitEyeOffset(body, root)()!;
    const camera = new PerspectiveCamera(65, 1440 / 900, .02, 20);
    camera.position.set(eye.x, eye.y, eye.z + .1); camera.lookAt(eye.x, eye.y, eye.z + 1.1); camera.updateMatrixWorld(true);
    const palms = ["L", "R"].map(side => joints.get(`socket_axe_${side}`)!.getWorldPosition(new Vector3()));
    for (const palm of palms) {
      const projected = palm.clone().project(camera);
      expect(Math.abs(projected.x), JSON.stringify({ variant, action, time, projected })).toBeLessThan(.95);
      expect(Math.abs(projected.y), JSON.stringify({ variant, action, time, projected })).toBeLessThan(.95);
    }
    for (const segment of segments) expect(segment.bone.position.toArray()).toEqual(segment.position);
    const centre = palms[0]!.clone().add(palms[1]!).multiplyScalar(.5).project(camera);
    expect(centre.x, JSON.stringify({ variant, centre, eye })).toBeGreaterThan(-.9);
    expect(centre.x).toBeLessThan(.9);
    expect(centre.y, JSON.stringify({ variant, centre, eye })).toBeGreaterThan(-.8);
    expect(centre.y).toBeLessThan(-.05);
    const positions = axe.geometry.getAttribute("position");
    const surface = axe.geometry.getAttribute("equipmentSurface");
    if (action === "idle_breathe") {
      const bladeNormal = new Vector3(0, 0, 1).transformDirection(axe.matrixWorld);
      expect(Math.abs(bladeNormal.y), "The parry shows the broad blade instead of pointing its face at the ground")
        .toBeLessThan(.1);
      const cuttingEdge = new Vector3(1, 0, 0).transformDirection(axe.matrixWorld);
      expect(cuttingEdge.y, "The defensive beard sits above the haft and near palms").toBeGreaterThan(.9);
    }
    for (let vertex = 0; vertex < positions.count; vertex++) {
      if (action !== "idle_breathe" || surface.getX(vertex) < .3) continue;
      const head = new Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(axe.matrixWorld).project(camera);
      expect(Math.abs(head.x), JSON.stringify({ variant, action, time, head })).toBeLessThan(.98);
      expect(Math.abs(head.y), JSON.stringify({ variant, action, time, head })).toBeLessThan(.98);
    }
    const origin = prop.getWorldPosition(new Vector3()), axis = new Vector3(0, 1, 0).transformDirection(prop.matrixWorld);
    for (const palm of palms) {
      const point = palm.clone().sub(origin); point.addScaledVector(axis, -point.dot(axis));
      expect(point.length()).toBeLessThan(.01);
    }
    const distance = (point: Vector3) => point.sub(origin).addScaledVector(axis, -point.dot(axis)).length() / WORKER_SCALE;
    for (const side of ["Left", "Right"] as const) for (const name of ["Index", "Middle", "Ring", "Pinky"])
      expect(distance(joints.get(`${side}Hand${name}4`)!.getWorldPosition(new Vector3())), `${variant}/${action}/${side}/${name}`).toBeLessThan(.04);
    body.traverse(object => {
      const mesh = object as import("three").SkinnedMesh; if (!mesh.isSkinnedMesh) return;
      const indices = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
      for (let vertex = 0; vertex < indices.count; vertex++) for (const side of ["Left", "Right"] as const) {
        let influence = 0;
        for (let channel = 0; channel < 4; channel++) if (mesh.skeleton.bones[indices.getComponent(vertex, channel)]!.name.startsWith(`${side}Hand`))
          influence += weights.getComponent(vertex, channel);
        if (influence < .4) continue;
        const clearance = distance(mesh.getVertexPosition(vertex, new Vector3()).applyMatrix4(mesh.matrixWorld)) - VIKING_AXE_GRIP_RADIUS[side];
        expect(clearance, JSON.stringify({ variant, action, time, side, vertex, clearance,
          fit: joints.get(`socket_axe_${side === "Left" ? "L" : "R"}`)!.userData,
          skin: [0, 1, 2, 3].map(channel => [mesh.skeleton.bones[indices.getComponent(vertex, channel)]!.name,
            weights.getComponent(vertex, channel)]) })).toBeGreaterThan(-.00001);
      }
    });
    pose.reset(); for (const [name, original] of originals) expect(joints.get(name)!.quaternion.toArray()).toEqual(original);
    axe.geometry.dispose(); axe.material.dispose();
    body.traverse(object => { const mesh = object as import("three").Mesh; mesh.geometry?.dispose(); });
  });
