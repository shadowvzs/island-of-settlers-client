import {
  Box3,
  type BufferGeometry,
  type Camera,
  CanvasTexture,
  DynamicDrawUsage,
  Euler,
  Frustum,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Sphere,
  Vector3} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { HandcartFrame } from "../../../render-common/logistics/handcart-frame";
import { cartCapacityFor } from "../../../render-common/logistics/handcart-rules";
import { variantBatchCapacity } from "../webgpu/variant-prewarm-hint";
import { createCartStrapGeometry, loadEnvelope } from "./cart-load-straps";
import { buildHandcartParts, createHandcartMaterials, placeCartCargo } from "./roman-handcart";
import { acquireWareMaterials } from "./ware-material-cache";
import { createWareModel } from "./ware-models";

/** From this camera zoom in (High's plant detail zoom) the full cart is drawn; farther out the light one. */
const DETAILED_ZOOM = 1.3;
const INITIAL_CAPACITY = 16;
/** Bounds of a cart with its load and shafts around the axle centre (metres). */
const CART_RADIUS = 1.1;

/** One instanced draw: a merged part of the cart (or of a cargo ware) and a local offset. */
interface InstancedPart {
  mesh: InstancedMesh;
  /** Transform from the cart (or cargo item) frame to the part's geometry frame. */
  local: Matrix4;
}

const createPart = (geometry: BufferGeometry, material: Material, local = new Matrix4()): InstancedPart => {
  const mesh = new InstancedMesh(geometry, material, variantBatchCapacity(INITIAL_CAPACITY));
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  // WebGPU: each pool compiles behind the loading screen, not on the first visible frame.
  mesh.userData.prewarmOwnPipeline = true;
  return { local, mesh };
};

/** Grows a part's instance buffer (doubling) so `needed` instances fit. */
const ensureCapacity = (part: InstancedPart, needed: number, parent: Object3D) => {
  if (needed <= part.mesh.instanceMatrix.count) return;
  const grown = new InstancedMesh(part.mesh.geometry, part.mesh.material,
    Math.max(needed, part.mesh.instanceMatrix.count * 2));
  grown.instanceMatrix.setUsage(DynamicDrawUsage);
  // Instances already written this frame move over, so a growing batch never drops a frame's items.
  grown.instanceMatrix.array.set(part.mesh.instanceMatrix.array);
  grown.frustumCulled = false;
  grown.count = 0;
  grown.userData.prewarmOwnPipeline = true;
  parent.remove(part.mesh);
  part.mesh.dispose();
  part.mesh = grown;
  parent.add(grown);
};

const isInside = (object: Object3D, ancestor: Object3D) => {
  for (let node: Object3D | null = object; node; node = node.parent) if (node === ancestor) return true;
  return false;
};

/** The meshes baked into one geometry per material, relative to `frame`. */
const mergeByMaterial = (meshes: readonly Mesh[], frame: Matrix4) => {
  const inverse = frame.clone().invert();
  const groups = new Map<Material, BufferGeometry[]>();
  for (const mesh of meshes) {
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(inverse.clone().multiply(mesh.matrixWorld));
    const material = mesh.material as Material;
    groups.set(material, [...groups.get(material) ?? [], geometry]);
  }
  return [...groups].flatMap(([material, list]) => {
    // Pieces with different vertex attributes cannot share a buffer: they stay separate draws.
    const merged = list.length > 1 ? mergeGeometries(list) : null;
    if (!merged) return list.map(geometry => ({ geometry, material }));
    list.forEach(geometry => geometry.dispose());
    return [{ geometry: merged, material }];
  });
};

/** One level of detail: the cart body batches and one batch set per wheel. */
const createCartLevel = (detailed: boolean, root: Group) => {
  const materials = createHandcartMaterials();
  const model = new Group();
  const { geometries, wheels } = buildHandcartParts(model, detailed, materials);
  model.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  model.traverse(object => { if (object instanceof Mesh) meshes.push(object); });
  const body = mergeByMaterial(meshes.filter(mesh => !wheels.some(wheel => isInside(mesh, wheel))), new Matrix4())
    .map(({ geometry, material }) => createPart(geometry, material));
  const wheelParts = wheels.map(wheel => ({
    offset: wheel.matrix.clone(),
    parts: mergeByMaterial(meshes.filter(mesh => isInside(mesh, wheel)), wheel.matrixWorld)
      .map(({ geometry, material }) => createPart(geometry, material))
  }));
  geometries.forEach(geometry => geometry.dispose());
  const all = [...body, ...wheelParts.flatMap(wheel => wheel.parts)];
  for (const part of all) {
    part.mesh.receiveShadow = true;
    root.add(part.mesh);
  }
  return { all, body, materials, wheelParts };
};

/**
 * A cargo ware merged per material, with cached bed placements per load size and, for a full
 * talent-raised load, its lashings (built once per load size, the first time it is drawn).
 */
const createCargoKind = (
  ware: string, detailed: boolean, materials: Parameters<typeof createWareModel>[2], root: Group, rope: Material
) => {
  const model = createWareModel(ware, detailed, materials);
  model.root.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  model.root.traverse(object => { if (object instanceof Mesh) meshes.push(object); });
  const parts = mergeByMaterial(meshes, model.root.matrixWorld).map(({ geometry, material }) => {
    const part = createPart(geometry, material);
    root.add(part.mesh);
    return part;
  });
  const slots = new Map<string, Matrix4>();
  const resetModel = () => {
    model.root.position.set(0, 0, 0); model.root.rotation.set(0, 0, 0); model.root.scale.setScalar(1);
    model.root.updateMatrixWorld(true);
  };
  /** `heaped`: a talent-raised load, its extra items on a top layer (cart-cargo-heap.ts). */
  const slot = (index: number, count: number, heaped = false) => {
    const key = `${index}/${count}/${Number(heaped)}`;
    let matrix = slots.get(key);
    if (matrix) return matrix;
    resetModel();
    placeCartCargo(model.root, ware, index, count, heaped);
    matrix = model.root.matrix.clone();
    slots.set(key, matrix);
    return matrix;
  };
  const straps = new Map<number, InstancedPart>();
  /** The ropes over a full heaped load of `count` items. */
  const strapPart = (count: number) => {
    let part = straps.get(count);
    if (part) return part;
    resetModel();
    const bounds = new Box3().setFromObject(model.root), base = Math.min(count, cartCapacityFor(ware));
    const slotsOf = (from: number, to: number) =>
      Array.from({ length: Math.max(0, to - from) }, (_, offset) => slot(from + offset, count, true));
    const layers = loadEnvelope(bounds, slotsOf(0, base));
    const heap = count > base ? loadEnvelope(bounds, slotsOf(base, count)) : layers;
    part = createPart(createCartStrapGeometry(layers, heap, detailed), rope);
    part.mesh.castShadow = detailed;
    root.add(part.mesh);
    straps.set(count, part);
    return part;
  };
  const dispose = () => {
    [...parts, ...straps.values()].forEach(part => {
      part.mesh.removeFromParent(); part.mesh.geometry.dispose(); part.mesh.dispose();
    });
    model.dispose();
  };
  return { dispose, parts, slot, strapPart, straps: () => straps.values() };
};

/** A soft dark ellipse under each cart, like the workers' contact rings. */
const createContactShadow = (root: Group) => {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(32, 32, 4, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)"); gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient; context.fillRect(0, 0, 64, 64);
  const texture = new CanvasTexture(canvas);
  const material = new MeshBasicMaterial({ alphaMap: texture, color: 0x252017, depthWrite: false,
    opacity: .3, transparent: true });
  const geometry = new PlaneGeometry(.95, 1.55).rotateX(-Math.PI / 2).translate(0, .012, -.04);
  const part = createPart(geometry, material);
  part.mesh.renderOrder = 1;
  root.add(part.mesh);
  return { dispose: () => { geometry.dispose(); material.dispose(); texture.dispose(); }, part };
};

/**
 * All hand carts in a few instanced draws: merged body and wheel batches per material (High and
 * a light zoomed-out level; Minimal only the light one), cargo merged per ware and material.
 */
export const createThreeHandcarts = (
  detailed: boolean, bridgeHeight?: (x: number, z: number) => number | undefined
) => {
  const root = new Group(); root.name = "handcarts";
  const levels = detailed
    ? [createCartLevel(true, root), createCartLevel(false, root)]
    : [createCartLevel(false, root)];
  const surfaces = acquireWareMaterials(detailed);
  /** Tarred rope lashing of full carts, dark against the timber (one material for every ware and nation). */
  const rope = new MeshStandardMaterial({ color: 0x3f352b, roughness: .9 });
  const cargoKinds = new Map<string, ReturnType<typeof createCargoKind>>();
  const shadow = createContactShadow(root);
  const cart = new Matrix4(), wheel = new Matrix4(), spin = new Matrix4(), item = new Matrix4();
  const instance = new Matrix4(), rotation = new Quaternion(), euler = new Euler(0, 0, 0, "YXZ");
  const position = new Vector3(), unit = new Vector3(1, 1, 1);
  const counts = new Map<InstancedPart, number>();

  const write = (part: InstancedPart, base: Matrix4) => {
    const index = counts.get(part) ?? 0;
    ensureCapacity(part, index + 1, root);
    part.mesh.setMatrixAt(index, instance.multiplyMatrices(base, part.local));
    counts.set(part, index + 1);
  };
  const cargoKind = (ware: string) => {
    let kind = cargoKinds.get(ware);
    if (!kind) {
      kind = createCargoKind(ware, detailed, surfaces.materials, root, rope);
      cargoKinds.set(ware, kind);
    }
    return kind;
  };
  /** Every item on the bed; a talent-raised load heaps up, and a full one is lashed down. */
  const drawCargo = (frame: HandcartFrame) => {
    if (!frame.ware || frame.count <= 0) return;
    const kind = cargoKind(frame.ware), heaped = frame.load !== "base";
    for (let index = 0; index < frame.count; index++) {
      item.multiplyMatrices(cart, kind.slot(index, frame.count, heaped));
      for (const part of kind.parts) write(part, item);
    }
    if (frame.load === "full") write(kind.strapPart(frame.count), cart);
  };
  const drawCart = (frame: HandcartFrame, level: ReturnType<typeof createCartLevel>) => {
    const deck = bridgeHeight?.(frame.x, frame.z);
    rotation.setFromEuler(euler.set(deck === undefined ? -frame.pitch : 0, frame.yaw, 0));
    cart.compose(position.set(frame.x, deck ?? frame.y, frame.z), rotation, unit);
    for (const part of level.body) write(part, cart);
    spin.makeRotationX(frame.wheelAngle);
    for (const { offset, parts } of level.wheelParts) {
      wheel.multiplyMatrices(cart, offset).multiply(spin);
      for (const part of parts) write(part, wheel);
    }
    write(shadow.part, cart);
    drawCargo(frame);
  };
  const commit = () => {
    const parts = [...levels.flatMap(level => level.all), shadow.part,
      ...[...cargoKinds.values()].flatMap(kind => [...kind.parts, ...kind.straps()])];
    for (const part of parts) {
      part.mesh.count = counts.get(part) ?? 0;
      part.mesh.visible = part.mesh.count > 0;
      if (part.mesh.count) part.mesh.instanceMatrix.needsUpdate = true;
    }
  };
  const frustum = new Frustum(), viewProjection = new Matrix4(), bounds = new Sphere(new Vector3(), CART_RADIUS);
  /** Draws the carts in view; `zoom` picks the level of detail. */
  const update = (frames: readonly HandcartFrame[], zoom: number, camera: Camera) => {
    counts.clear();
    const level = levels[levels.length > 1 && zoom < DETAILED_ZOOM ? 1 : 0]!;
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    for (const frame of frames) {
      bounds.center.set(frame.x, (bridgeHeight?.(frame.x, frame.z) ?? frame.y) + .4, frame.z);
      if (frustum.intersectsSphere(bounds)) drawCart(frame, level);
    }
    commit();
  };
  const dispose = () => {
    for (const level of levels) {
      level.all.forEach(part => { part.mesh.geometry.dispose(); part.mesh.dispose(); });
      level.materials.dispose();
    }
    cargoKinds.forEach(kind => kind.dispose());
    rope.dispose();
    surfaces.release();
    shadow.dispose();
    root.removeFromParent();
  };
  return { dispose, root, update };
};
