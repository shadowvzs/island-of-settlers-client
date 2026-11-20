import { Box3, BoxGeometry, type BufferGeometry,CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D,
  TorusGeometry, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

import { cartHeapSlot } from "../../../render-common/logistics/cart-cargo-heap";
import { CART_CARGO_LAYOUTS } from "../../../render-common/logistics/cart-cargo-layouts";
import { cartLoadFits, HANDCART } from "../../../render-common/logistics/handcart-rules";
import { createMilitaryWoodTexture } from "../military-wood-texture";
import { acquireWareMaterials } from "./ware-material-cache";
import { createWareModel } from "./ware-models";

/** Timber with a fine grain map, end grain, and two iron finishes. */
export const createHandcartMaterials = () => {
  const grain = createMilitaryWoodTexture();
  const wood = new MeshStandardMaterial({ color: 0xa2865e, map: grain, roughness: .85 });
  const endgrain = new MeshStandardMaterial({ color: 0x806246, map: grain, roughness: .9 });
  const iron = new MeshStandardMaterial({ color: 0x48443c, metalness: .72, roughness: .55 });
  const wornIron = new MeshStandardMaterial({ color: 0x726b5b, metalness: .68, roughness: .47 });
  const list = [wood, endgrain, iron, wornIron];
  return { endgrain, iron, list, wood, wornIron,
    dispose: () => { list.forEach(material => material.dispose()); grain.dispose(); } };
};
type HandcartMaterials = ReturnType<typeof createHandcartMaterials>;

/**
 * The cart's joined timber and iron parts under `root`: undercarriage, bed, rails, axle and two
 * wheel groups (named cart_wheel_left/right) that turn about the axle.
 */
export const buildHandcartParts = (root: Object3D, detailed: boolean, materials: HandcartMaterials) => {
  const { endgrain, iron, wood, wornIron } = materials;
  const geometries: BufferGeometry[] = [];
  const add = (parent: Object3D, geometry: BufferGeometry, material: MeshStandardMaterial,
    x: number, y: number, z: number) => {
    const mesh = new Mesh(geometry, material); mesh.position.set(x, y, z);
    mesh.castShadow = detailed; mesh.receiveShadow = true;
    parent.add(mesh); geometries.push(geometry); return mesh;
  };
  const beam = (parent: Object3D, width: number, height: number, depth: number,
    x: number, y: number, z: number, material = wood) => add(parent,
    detailed ? new RoundedBoxGeometry(width, height, depth, 1, .003)
      : new BoxGeometry(width, height, depth), material, x, y, z);
  const rod = (parent: Object3D, start: Vector3, end: Vector3, radius: number,
    material = wood, segments = detailed ? 10 : 5) => {
    const direction = end.clone().sub(start);
    const mesh = add(parent, new CylinderGeometry(radius, radius, direction.length(), segments),
      material, ...start.clone().add(end).multiplyScalar(.5).toArray() as [number, number, number]);
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
    return mesh;
  };
  // Continuous undercarriage bears the bed, axle blocks and both pulling handles.
  for (const x of [-.19, .19]) {
    beam(root, .055, .065, .76, x, .342, -.045);
    beam(root, .072, .08, .10, x, .295, -.035, endgrain);
    const shaft = beam(root, .037, .039, 1.32, x, .47, .384);
    shaft.rotation.x = -.185;
    const grip = rod(root, new Vector3(x, .599, .91), new Vector3(x, .62, 1.02), .025, endgrain);
    grip.name = x < 0 ? "cart_grip_right" : "cart_grip_left";
  }
  for (const z of [-.35, -.03, .28]) beam(root, .46, .048, .046, 0, .37, z);
  for (let plank = 0; plank < 6; plank++)
    beam(root, .069, .028, .68, (plank - 2.5) * .074, .41, -.045, plank % 2 ? wood : endgrain);
  // Rail posts are seated into the frame, with mortise collars and iron corner straps.
  for (const x of [-.228, .228]) for (const z of [-.385, .295]) {
    beam(root, .035, .25, .035, x, .515, z);
    beam(root, .038, .045, .04, x, .415, z, iron);
    beam(root, .039, .055, .008, x, .61, z + (z < 0 ? -.02 : .02), iron);
  }
  for (const x of [-.228, .228]) for (const y of [.485, .585])
    beam(root, .027, .052, .70, x, y, -.045);
  for (const z of [-.385, .295]) for (const y of [.485, .585])
    beam(root, .455, .052, .027, 0, y, z);
  const axle = rod(root, new Vector3(-.347, HANDCART.wheelRadius, -.035),
    new Vector3(.347, HANDCART.wheelRadius, -.035), .024, iron);
  axle.name = "cart_supported_axle";
  const wheels: Group[] = [];
  for (const side of [-1, 1]) {
    const wheel = new Group(); wheel.name = side < 0 ? "cart_wheel_right" : "cart_wheel_left";
    wheel.position.set(side * HANDCART.wheelHalfGauge, HANDCART.wheelRadius, -.035);
    root.add(wheel); wheels.push(wheel);
    const rim = add(wheel, new TorusGeometry(.215, .020, detailed ? 8 : 4, detailed ? 56 : 16), wood, 0, 0, 0);
    rim.rotation.y = Math.PI / 2;
    const tyre = add(wheel, new TorusGeometry(.229, .006, detailed ? 6 : 3, detailed ? 64 : 16), iron, 0, 0, 0);
    tyre.rotation.y = Math.PI / 2;
    const hub = add(wheel, new CylinderGeometry(.049, .055, .083, detailed ? 20 : 8), endgrain, 0, 0, 0);
    hub.rotation.z = Math.PI / 2;
    for (const offset of [-.035, .035]) {
      const band = add(wheel, new TorusGeometry(.051, .005, detailed ? 6 : 3, detailed ? 24 : 10), wornIron, offset, 0, 0);
      band.rotation.y = Math.PI / 2;
    }
    for (let spoke = 0; spoke < (detailed ? 12 : 8); spoke++) {
      const angle = spoke * Math.PI * 2 / (detailed ? 12 : 8);
      rod(wheel, new Vector3(side * .015, Math.sin(angle) * .041, Math.cos(angle) * .041),
        new Vector3(0, Math.sin(angle) * .207, Math.cos(angle) * .207), .010);
      if (detailed) {
        const rivet = add(wheel, new CylinderGeometry(.006, .006, .004, 6), iron,
          side * .021, Math.sin(angle) * .216, Math.cos(angle) * .216);
        rivet.rotation.z = Math.PI / 2;
      }
    }
    const pin = rod(wheel, new Vector3(side * .052, -.018, 0), new Vector3(side * .052, .019, 0), .004, iron);
    pin.name = "cart_axle_retaining_pin";
  }
  if (detailed) for (const x of [-.195, .195]) for (const z of [-.345, .26]) {
    const nail = add(root, new CylinderGeometry(.0045, .0045, .003, 6), iron, x, .425, z);
    nail.name = "cart_bed_nail";
  }
  return { geometries, wheels };
};

/** Trunks lie along the bed, side by side, instead of shrinking into a crosswise slot. */
const placeLengthwise = (model: Object3D, index: number, count: number) => {
  const raw = new Box3().setFromObject(model).getSize(new Vector3());
  if (raw.x > raw.z) model.rotation.y = Math.PI / 2;
  model.updateMatrixWorld(true);
  const size = new Box3().setFromObject(model).getSize(new Vector3());
  const width = .36 / count;
  model.scale.setScalar(Math.min(1, .62 / Math.max(size.z, .001), width / Math.max(size.x, .001),
    .18 / Math.max(size.y, .001)));
  model.updateMatrixWorld(true);
  const placed = new Box3().setFromObject(model), center = placed.getCenter(new Vector3());
  model.position.set((index - (count - 1) / 2) * width - center.x, .427 - placed.min.y, -.05 - center.z);
};

/** Up to three items lie in one row; more share the bed in two rows side by side. */
const placeInRows = (model: Object3D, index: number, count: number) => {
  const rows = count > 3 ? 2 : 1, perRow = Math.ceil(count / rows);
  const size = new Box3().setFromObject(model).getSize(new Vector3());
  model.scale.setScalar(Math.min(1, .38 / rows / Math.max(size.x, .001), .19 / Math.max(size.z, .001),
    .18 / Math.max(size.y, .001)));
  model.updateMatrixWorld(true);
  const placed = new Box3().setFromObject(model);
  const center = placed.getCenter(new Vector3());
  const row = Math.floor(index / perRow), slot = index % perRow;
  const x = rows === 1 ? 0 : (row - .5) * .19;
  model.position.set(x - center.x, .427 - placed.min.y, -.265 + slot * .215 - center.z);
};

/**
 * Places item `index` of `count` identical wares (a fresh, unplaced model) on the cart bed. `heaped`:
 * a talent-raised load, whose items beyond the audited layout lie on a top layer (cart-cargo-heap.ts).
 */
export const placeCartCargo = (model: Object3D, ware: string, index: number, count: number, heaped = false) => {
  const layout = CART_CARGO_LAYOUTS[ware as keyof typeof CART_CARGO_LAYOUTS];
  if (!layout || (count > layout.count && !heaped)) {
    // Compatibility for a paid load dispatched before the capacity audit.
    if (ware === "logs" || ware === "hardwoodLogs") placeLengthwise(model, index, count);
    else placeInRows(model, index, count);
    model.updateMatrix(); return;
  }
  model.rotation.order = "YXZ";
  if (layout.layDown) model.rotation.x = Math.PI / 2;
  if (layout.turned) model.rotation.y = Math.PI / 2;
  model.scale.setScalar(layout.scale); model.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(model), center = bounds.getCenter(new Vector3());
  const { column, layer, row } = cartHeapSlot(layout, index);
  const x = (column - (layout.columns - 1) / 2) * (layout.width + .012);
  const z = -.045 + (row - (layout.rows - 1) / 2) * (layout.depth + .012);
  model.position.set(x - center.x, .427 + layer * (layout.height + .006) - bounds.min.y, z - center.z);
  model.updateMatrix();
};

/** A Roman timber handcart: fitted axle, dished spoke wheels, iron tyres and joined shafts. */
export const createRomanHandcart = (detailed: boolean) => {
  const root = new Group(); root.name = "roman_handcart";
  const materials = createHandcartMaterials();
  const { geometries, wheels } = buildHandcartParts(root, detailed, materials);
  const cargoRoot = new Group(); cargoRoot.name = "cart_supported_cargo"; root.add(cargoRoot);
  const surfaces = acquireWareMaterials(detailed);
  const cargo: ReturnType<typeof createWareModel>[] = [];
  const setLoad = (wares: readonly string[]) => {
    if (!cartLoadFits(wares)) throw new Error("This load does not fit a handcart");
    cargo.splice(0).forEach(ware => ware.dispose());
    for (const [index, ware] of wares.entries()) {
      const model = createWareModel(ware, detailed, surfaces.materials);
      if (new Set(wares).size > 1) placeInRows(model.root, index, wares.length);
      else placeCartCargo(model.root, ware, index, wares.length);
      cargoRoot.add(model.root);
      cargo.push(model);
    }
  };
  let wheelAngle = 0;
  const advance = (distance: number) => {
    if (!Number.isFinite(distance)) return;
    wheelAngle = (wheelAngle + distance / HANDCART.wheelRadius) % (Math.PI * 2);
    for (const wheel of wheels) wheel.rotation.x = wheelAngle;
  };
  return { root, setLoad, advance,
    triangles: () => { let count = 0; root.traverse(object => {
      if (object instanceof Mesh) count += (object.geometry.index?.count ?? object.geometry.attributes.position!.count) / 3;
    }); return count; },
    dispose: () => { cargo.splice(0).forEach(ware => ware.dispose()); surfaces.release();
      geometries.forEach(geometry => geometry.dispose()); materials.dispose(); root.removeFromParent(); }
  };
};
