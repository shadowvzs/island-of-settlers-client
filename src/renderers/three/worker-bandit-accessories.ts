import {
  BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  Group, Mesh, MeshStandardMaterial, type Object3D,
Quaternion, SphereGeometry, Vector2, Vector3} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { AdventureBanditStyle } from "../../render-common/workers/adventure-bandit-style";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { createCampFabricTextures } from "./settlement/camp-fabric-textures";
import { javelinHeld, javelinPose } from "./worker-javelin-pose";
import { orientMeleeWeapon } from "./worker-melee-weapon";
import { createPirateBrim } from "./worker-pirate-headgear";

const kits = new Map<boolean, ReturnType<typeof createKit>>();

/** Folded cloth follows the existing head, leaving the eyes/face visible; never a replacement face. */
const faceWrap = (detailed: boolean, lower: number, upper: number, radius: number) => {
  const across = detailed ? 18 : 8, rows = detailed ? 5 : 2;
  const vertices: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let row = 0; row <= rows; row++) for (let column = 0; column <= across; column++) {
    const angle = (column / across - .5) * 2.65;
    const fold = detailed ? Math.sin(row / rows * Math.PI * 4 + angle * 3) * .0025 : 0;
    const reach = radius + fold;
    const rounding = Math.pow(Math.abs(angle) / 1.325, 4) * .008;
    const low = lower + rounding, high = upper - rounding;
    vertices.push(Math.sin(angle) * reach, low + (high - low) * row / rows,
      Math.cos(angle) * reach);
    uvs.push(column / across * 3, row / rows);
  }
  for (let row = 0; row < rows; row++) for (let column = 0; column < across; column++) {
    const a = row * (across + 1) + column, b = a + across + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};

const merge = (parts: BufferGeometry[]) => {
  const flat = parts.map(part => part.index ? part.toNonIndexed() : part);
  const result = mergeGeometries(flat);
  for (const geometry of new Set([...flat, ...parts])) geometry.dispose();
  return result;
};

const createKit = (detailed: boolean) => {
  const fabric = createCampFabricTextures(detailed);
  const materials = new Map<string, MeshStandardMaterial>(), geometry = new Map<string, BufferGeometry>();
  const materialFor = (key: string, color: number, cloth = true) => {
    let material = materials.get(key);
    if (!material) {
      material = new MeshStandardMaterial({ color, map: cloth ? fabric.map : undefined, normalMap: cloth ? fabric.normalMap : undefined,
        normalScale: new Vector2(.18, .18), roughnessMap: cloth ? fabric.roughnessMap : undefined,
        roughness: cloth ? .95 : .5,
        metalness: cloth ? 0 : .35, side: DoubleSide }); materials.set(key, material);
    }
    return material;
  };
  const geometryFor = (style: AdventureBanditStyle) => {
    const key = `${style.headgear}:${style.masked}`;
    let mesh = geometry.get(key);
    if (mesh) return mesh;
    const tricorn = style.headgear.startsWith("tricorn-");
    const wrapped = style.headgear === "headscarf" || style.headgear === "bandanna";
    const shell = new SphereGeometry(.121, detailed ? 22 : 10, detailed ? 12 : 6,
      wrapped || tricorn ? 0 : Math.PI / 2 + .73,
      wrapped || tricorn ? Math.PI * 2 : Math.PI * 2 - 1.46,
      0, wrapped || tricorn ? 1.3 : 1.85);
    shell.scale(1.04, 1.25, wrapped || tricorn ? 1.25 : 1); shell.translate(0, .067, 0);
    const parts: BufferGeometry[] = [shell];
    if (wrapped) parts.push(faceWrap(detailed, .107, .147, .138));
    if (tricorn) parts.push(createPirateBrim(detailed, style.headgear === "tricorn-tall"));
    if (style.headgear === "bandanna") {
      // A tied knot behind the ear follows the same head bone and shares the cloth draw.
      const knot = new SphereGeometry(.023, detailed ? 8 : 5, detailed ? 5 : 3);
      knot.scale(1, .7, 1.15); knot.translate(.11, .12, -.075); parts.push(knot);
      const tail = new ConeGeometry(.025, .11, detailed ? 7 : 4, 1, true);
      tail.scale(.5, 1, 1); tail.rotateZ(.35); tail.translate(.12, .064, -.08); parts.push(tail);
    }
    if (style.masked) parts.push(faceWrap(detailed, -.03, .04, .12));
    // Folded collar is a separate continuous wrap around the neck, not a sphere hiding the face.
    const collar = new CylinderGeometry(.102, .087, .045, detailed ? 20 : 10, 1, true);
    collar.translate(0, -.045, 0); parts.push(collar);
    mesh = merge(parts); geometry.set(key, mesh); return mesh;
  };
  const shaft = new CylinderGeometry(.008, .008, 1.08, detailed ? 8 : 4); shaft.translate(0, .20, 0);
  const point = new ConeGeometry(.025, .16, detailed ? 6 : 3); point.scale(1, 1, .4); point.translate(0, .82, 0);
  const binding = new CylinderGeometry(.012, .012, .055, detailed ? 10 : 4); binding.translate(0, .713, 0);
  for (const [piece, tint] of [[shaft, 0x866039], [point, 0xa3aaae], [binding, 0xc7ad7e]] as const) {
    const color = new Color(tint), count = piece.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    for (let index = 0; index < count; index++) colors.set([color.r, color.g, color.b], index * 3);
    piece.setAttribute("color", new Float32BufferAttribute(colors, 3));
  }
  const spearGeometry = merge([shaft, point, binding]);
  const spearMaterial = materialFor("javelin", 0xffffff, false);
  spearMaterial.vertexColors = true; spearMaterial.metalness = .15; spearMaterial.roughness = .72;
  const hood = (style: AdventureBanditStyle) => {
    const root = new Group(); root.name = "adventure_bandit_headgear";
    root.add(new Mesh(geometryFor(style), materialFor(`cloth:${style.cloth}`, style.cloth)));
    if (style.headgear === "fur-hood") {
      let fur = geometry.get("fur");
      if (!fur) {
        const pieces = Array.from({ length: detailed ? 24 : 10 }, (_, index) => {
          const angle = (index / (detailed ? 23 : 9) - .5) * Math.PI;
          const puff = new SphereGeometry(.024 + Math.sin(index * 2.7) * .003, detailed ? 7 : 4, detailed ? 5 : 3);
          puff.scale(.95, 1.1 + Math.sin(index * 1.8) * .2, .8);
          puff.translate(Math.sin(angle) * .12, .08 + Math.cos(angle) * .13, .055 + Math.sin(index * 2.3) * .004);
          return puff;
        }); fur = merge(pieces); geometry.set("fur", fur);
      }
      root.add(new Mesh(fur, materialFor(`fur:${style.trim}`, style.trim)));
    }
    return root;
  };
  const spear = () => {
    const root = new Group(); root.name = "bandit_held_javelin";
    root.add(new Mesh(spearGeometry, spearMaterial));
    root.userData.meleeAxes = { blade: new Vector3(0, 1, 0), edge: new Vector3(1, 0, 0) };
    return root;
  };
  return { refs: 0, hood, spear, dispose: () => {
    for (const mesh of geometry.values()) mesh.dispose(); spearGeometry.dispose();
    for (const material of materials.values()) material.dispose(); fabric.dispose();
  } };
};

/** One shared kit per quality; bones, hand targets and original armour are cached once per member. */
export const createWorkerBanditAccessories = (body: Object3D, detailed: boolean) => {
  const head = body.getObjectByName("Head"), hand = body.getObjectByName("socket_hand_R");
  const helmets: Array<{ object: Object3D; visible: boolean }> = [];
  body.traverse(object => { if (/^armour_(helmet|head)/i.test(object.name)) helmets.push({ object, visible: object.visible }); });
  // Imported rigs use different head bone axes. Cancel their rest rotation so cloth opens
  // towards the body's face, then let the current head bone carry all subsequent head turns.
  const headRest = new Quaternion(), bodyRest = new Quaternion();
  body.updateMatrixWorld(true);
  if (head) headRest.copy(body.getWorldQuaternion(bodyRest).invert().multiply(head.getWorldQuaternion(new Quaternion()))).invert();
  let kit: ReturnType<typeof createKit> | undefined, worn: AdventureBanditStyle | undefined;
  let hood: Group | undefined, spear: Group | undefined;
  let disposed = false;
  const position = new Vector3(), rootRotation = new Quaternion(), handRotation = new Quaternion();
  return {
    /** `worldCurrent` skips the forced world update of the baked GPU pose (C06b far props). */
    update: (frame: WorkerFrame, worldCurrent = false) => {
      if (disposed) return;
      let style: AdventureBanditStyle | undefined;
      if (frame.fall !== undefined) style = frame.fallenBandit;
      else if (frame.combat?.faction) style = frame.combat.bandit;
      if (!style) {
        if (hood) hood.visible = false; if (spear) spear.visible = false;
        if (worn) for (const helmet of helmets) helmet.object.visible = helmet.visible;
        worn = undefined; return;
      }
      if (!kit) { kit = kits.get(detailed) ?? createKit(detailed); kits.set(detailed, kit); kit.refs++; }
      if (style !== worn) { hood?.removeFromParent(); hood = kit.hood(style); hood.quaternion.copy(headRest); head?.add(hood); worn = style; }
      if (hood) {
        let fit = 1;
        if (frame.nation === "roman") fit = .82;
        else if (frame.nation === "nubian") fit = .92;
        else if (frame.nation === "japanese") fit = .95;
        // Japanese swept rear hair needs depth clearance without widening the face wrap.
        hood.scale.set(fit, fit, frame.nation === "japanese" ? fit * 1.12 : fit);
        hood.position.set(0, frame.nation === "roman" ? -.015 : 0, 0).applyQuaternion(headRest);
        hood.visible = true;
      }
      for (const helmet of helmets) helmet.object.visible = false;
      const throwing = frame.combat?.type === "archer" && style.rangedWeapon === "javelin";
      if (!throwing || !hand) { if (spear) spear.visible = false; return; }
      if (!spear) { spear = kit.spear(); body.add(spear); }
      spear.visible = !frame.lean && javelinHeld(frame.combat!.attackProgress);
      if (!worldCurrent) body.updateMatrixWorld(true);
      spear.position.copy(body.worldToLocal(hand.getWorldPosition(position)));
      spear.quaternion.copy(body.getWorldQuaternion(rootRotation).invert().multiply(hand.getWorldQuaternion(handRotation)));
      const marching = frame.combat!.attackProgress === null && ["walk", "run"].includes(frame.action);
      const pose = javelinPose(frame.combat!.attackProgress);
      orientMeleeWeapon(spear, body, marching ? { ...pose, pitch: .2 } : pose, false, worldCurrent);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      hood?.removeFromParent(); spear?.removeFromParent();
      if (kit && --kit.refs === 0) { kit.dispose(); kits.delete(detailed); }
      kit = undefined;
    }
  };
};
