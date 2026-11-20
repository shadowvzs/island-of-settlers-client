import { type BufferGeometry, Group, Mesh, type MeshStandardMaterial, type Object3D, Quaternion, Triangle, Vector3 } from "three";

import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { smoothstep01 } from "../../shared/world/noise";
import { createStretchedHideGeometry } from "./buildings/roman-stretched-hide";

interface HidePlacement {
  position: Vector3;
  rotation: Quaternion;
  scale: Vector3;
}
interface HideTransferState {
  stockPivot: Vector3;
  carryPivot: Vector3;
  currentPivot: Vector3;
  stockGrip: Vector3;
  carryGrip: Vector3;
  desiredGrip: Vector3;
  offset: Vector3;
}
const hideTransfers = new WeakMap<Object3D, HideTransferState>();

interface SurfaceSample { vertices: readonly [number, number, number]; weights: Vector3 }
const hideSurfaceSample = (geometry: BufferGeometry, wanted: Vector3): SurfaceSample => {
  const position = geometry.getAttribute("position"), index = geometry.index!;
  const triangle = new Triangle(), nearest = new Vector3();
  let distance = Infinity, result: SurfaceSample = { vertices: [0, 0, 0], weights: new Vector3(1, 0, 0) };
  for (let at = 0; at < index.count; at += 3) {
    const vertices = [index.getX(at), index.getX(at + 1), index.getX(at + 2)] as const;
    triangle.a.fromBufferAttribute(position, vertices[0]); triangle.b.fromBufferAttribute(position, vertices[1]);
    triangle.c.fromBufferAttribute(position, vertices[2]); triangle.closestPointToPoint(wanted, nearest);
    const next = nearest.distanceToSquared(wanted);
    if (next >= distance) continue;
    distance = next; result = { vertices, weights: triangle.getBarycoord(nearest, new Vector3())! };
  }
  return result;
};

/** The same one-piece skin as the rack, folded twice for transport; no rack cords travel with it. */
export const createWorkerHide = (material: MeshStandardMaterial, detailed: boolean) => {
  const geometry = createStretchedHideGeometry(detailed), position = geometry.getAttribute("position");
  const original = Float32Array.from(position.array);
  const root = new Group(), shape = new Group(); root.name = "ware_hides"; shape.name = "ware_geometry";
  const mesh = new Mesh(geometry, material); mesh.castShadow = mesh.receiveShadow = detailed;
  shape.add(mesh); root.add(shape); root.userData.sharedWareMaterials = true;
  let previous = -1;
  const gripSamples: SurfaceSample[] = [];
  const vertex = new Vector3();
  root.userData.hideGripTargets = [new Vector3(), new Vector3()];
  root.userData.foldHide = (fold: number) => {
    if (Math.abs(fold - previous) < 1e-6) return;
    previous = fold; root.userData.hideFold = fold;

    for (let at = 0; at < position.count; at++) {
      const x = original[at * 3]! * .5, y = original[at * 3 + 1]! * .8;
      const z = original[at * 3 + 2]! * .05;
      const foldedX = -Math.abs(x) + .125, foldedY = -Math.abs(y) + .2;
      const layer = (y > 0 ? .004 : 0) + (x > 0 ? .008 : 0) - .004;
      // Soft skin bunches into the compact template without swinging a half-metre flap through its carrier.
      const crease = .015 * Math.sin(Math.PI * fold) * Math.sin(original[at * 3]! * Math.PI * 2);
      position.setXYZ(at, x + (-foldedY - x) * fold, y + (foldedX - y) * fold, z + layer * fold + crease);
    }
    for (const [index, sample] of gripSamples.entries()) {
      const target: Vector3 = root.userData.hideGripTargets[index]; target.set(0, 0, 0);
      for (let corner = 0; corner < 3; corner++) target.addScaledVector(
        vertex.fromBufferAttribute(position, sample.vertices[corner]!), sample.weights.getComponent(corner));
    }
    position.needsUpdate = true; geometry.computeVertexNormals(); geometry.computeBoundingSphere(); geometry.computeBoundingBox();
  };
  root.userData.foldHide(0);
  gripSamples.push(hideSurfaceSample(geometry, new Vector3(-.10, -.22, .025)),
    hideSurfaceSample(geometry, new Vector3(.10, -.22, .025)));
  previous = -1; root.userData.foldHide(0);
  const stockPivot = root.userData.hideGripTargets[0].clone().add(root.userData.hideGripTargets[1]).multiplyScalar(.5);
  root.userData.foldHide(1);
  const sample = hideSurfaceSample(geometry, new Vector3(0, .125, .04)), carryPivot = new Vector3();
  for (let corner = 0; corner < 3; corner++) carryPivot.addScaledVector(
    vertex.fromBufferAttribute(position, sample.vertices[corner]!), sample.weights.getComponent(corner));
  hideTransfers.set(root, { stockPivot, carryPivot, currentPivot: new Vector3(), stockGrip: new Vector3(),
    carryGrip: new Vector3(), desiredGrip: new Vector3(), offset: new Vector3() });
  return root;
};

export const updateWorkerHideFold = (prop: Object3D, transfer?: WorkerFrame["wareTransfer"]) => {
  let fold = 1;
  if (transfer?.presentation === "hanging") {
    const lift = transfer.direction === "pickup" ? smoothstep01((transfer.progress - .4) / .55)
      : 1 - smoothstep01(transfer.progress / .72);
    fold = smoothstep01(lift * 2);
  }
  prop.userData.foldHide?.(fold);
};

/** Fold upright first, then tilt around the held crease. Centre-based rotation pulls the skin beyond the arms. */
export const placeTransferredHide = (prop: Object3D, stock: HidePlacement, carry: HidePlacement, lift: number) => {
  const state = hideTransfers.get(prop);
  if (!state) return false;
  const fold = prop.userData.hideFold as number;
  state.stockGrip.copy(state.stockPivot).multiply(stock.scale).applyQuaternion(stock.rotation).add(stock.position);
  state.carryGrip.copy(state.carryPivot).multiply(carry.scale).applyQuaternion(carry.rotation).add(carry.position);
  state.desiredGrip.copy(state.stockGrip).lerp(state.carryGrip, lift);
  const grips = prop.userData.hideGripTargets as Vector3[];
  state.currentPivot.copy(grips[0]!).add(grips[1]!).multiplyScalar(.5).lerp(state.carryPivot, fold);
  prop.quaternion.copy(stock.rotation).slerp(carry.rotation, smoothstep01((lift - .5) * 2));
  state.offset.copy(state.currentPivot).multiply(prop.scale).applyQuaternion(prop.quaternion);
  prop.position.copy(state.desiredGrip).sub(state.offset);
  return true;
};

export const hideCarryPivot = (prop: Object3D) => hideTransfers.get(prop)?.carryPivot;
