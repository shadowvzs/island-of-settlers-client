import {
  BoxGeometry, type BufferGeometry, CylinderGeometry, Euler, Float32BufferAttribute, Group,
  Matrix4, Mesh, type MeshStandardMaterial, Quaternion, TorusGeometry, Vector3
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import {
  CHEST_COIN_DIAMETER, CHEST_COIN_THICKNESS, COIN_CHEST, createCoinChestPacking, visibleChestCoins
} from "../../../render-common/logistics/coin-chest";
import { createWareRecipe } from "../../../render-common/wares/ware-recipe";
import { createCoinChestMaterials } from "./coin-chest-materials";
import { acquireCoinFaceMaterial } from "./coin-face-material";

type Point = [number, number, number];
type Surface = "wood" | "iron" | "gold" | "face";
export interface CoinChestOptions { detailed: boolean; lid?: "open" | "closed" | "none"; units: number }

const colorGeometry = (geometry: BufferGeometry, shade = 1) => {
  const colors = new Float32Array(geometry.getAttribute("position").count * 3).fill(shade);
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
};

type AddGeometry = (geometry: BufferGeometry, surface: Surface, position: Point, rotation?: Point) => void;

const addChestRivets = (detailed: boolean, height: number, add: AddGeometry) => {
  if (!detailed) return;
  for (const x of [-.17, .17]) for (const y of [.05, height - .04]) {
    const rivet = new CylinderGeometry(.0045, .0045, .004, 6);
    add(rivet, "iron", [x, y, COIN_CHEST.depth / 2 + .008], [Math.PI / 2, 0, 0]);
  }
};

/** Original presentation model; creating it never changes a ware count or capacity. */
export const createCoinChestModel = ({ detailed, lid = "open", units }: CoinChestOptions) => {
  const packing = createCoinChestPacking(units), visible = visibleChestCoins(packing, detailed);
  const contentsVisible = lid !== "closed" && units > 0;
  const materials = createCoinChestMaterials(detailed, contentsVisible);
  const face = contentsVisible ? acquireCoinFaceMaterial(materials.gold, detailed) : undefined;
  const root = new Group(); root.name = "coin_transport_chest";
  root.userData = { capacity: COIN_CHEST.capacity, units, visualCoins: visible.length, lid };
  const surfaces: Record<Surface, MeshStandardMaterial> = { ...materials, face: face?.material ?? materials.gold };
  const groups = new Map<Surface, BufferGeometry[]>();
  const add = (geometry: BufferGeometry, surface: Surface, position: Point, rotation?: Point, shade = 1) => {
    if (!geometry.hasAttribute("color")) colorGeometry(geometry, shade);
    if (rotation) {
      geometry.rotateX(rotation[0]); geometry.rotateY(rotation[1]); geometry.rotateZ(rotation[2]);
    }
    geometry.translate(...position);
    if (geometry.index) { const flat = geometry.toNonIndexed(); geometry.dispose(); geometry = flat; }
    geometry.clearGroups();
    const list = groups.get(surface) ?? []; list.push(geometry); groups.set(surface, list);
  };
  const beam = (size: Point, position: Point, surface: Surface = "wood", rotation?: Point, shade = 1) => {
    const geometry = detailed && surface === "wood" ? new RoundedBoxGeometry(...size, 1, Math.min(.0018, Math.min(...size) / 5))
      : new BoxGeometry(...size);
    // Grain's long direction follows each board's own longest axis, including the bottom/lid.
    const p = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
    const axis = size.indexOf(Math.max(...size));
    for (let index = 0; index < p.count; index++) {
      const coordinates = [p.getX(index), p.getY(index), p.getZ(index)];
      uv.setXY(index, coordinates[(axis + 1) % 3]! / Math.max(.02, size[(axis + 1) % 3]!) + .5,
        coordinates[axis]! / size[axis]! + .5);
    }
    add(geometry, surface, position, rotation, shade);
  };
  const { depth, height, wall, width } = COIN_CHEST;
  // Real slatted floor seated into four walls. No separate display pedestal.
  for (let board = 0; board < 6; board++)
    beam([width / 6 - .001, .024, depth], [(board - 2.5) * width / 6, .012, 0], "wood", undefined, .92 + board * .013);
  const courses = 4;
  for (let course = 0; course < courses; course++) {
    const y = .024 + (height - .024) / courses * (course + .5);
    const boardHeight = (height - .024) / courses - .001;
    for (const z of [-1, 1]) beam([width, boardHeight, wall], [0, y, z * (depth - wall) / 2],
      "wood", undefined, .91 + course * .028);
    for (const x of [-1, 1]) beam([wall, boardHeight, depth - wall * 2], [x * (width - wall) / 2, y, 0],
      "wood", undefined, .96 + course * .012);
  }
  // Narrow corner protection and through straps wrap existing boards rather than float beside them.
  for (const x of [-width / 2 + .015, width / 2 - .015]) for (const z of [-depth / 2, depth / 2])
    beam([.030, height - .012, .006], [x, height / 2, z], "iron");
  for (const x of [-.17, .17]) {
    beam([.025, .006, depth + .008], [x, .006, 0], "iron");
    for (const z of [-depth / 2 - .003, depth / 2 + .003])
      beam([.025, height - .009, .006], [x, height / 2, z], "iron");
  }
  // Side lifting handles hinge from two attached eyes; no unsupported decorative chains.
  for (const sign of [-1, 1]) {
    const x = sign * (width / 2 + .004);
    for (const z of [-.045, .045]) beam([.012, .033, .025], [x, .155, z], "iron");
    const handle = new TorusGeometry(.045, .006, detailed ? 5 : 3, detailed ? 16 : 8, Math.PI);
    add(handle, "iron", [x + sign * .012, .155, 0], [0, Math.PI / 2, Math.PI]);
    if (detailed) for (const z of [-.045, .045]) {
      const pin = new CylinderGeometry(.005, .005, .014, 6);
      add(pin, "iron", [x + sign * .004, .155, z], [0, 0, Math.PI / 2]);
    }
  }
  beam([.026, .055, .009], [0, height - .025, depth / 2 + .005], "iron");
  addChestRivets(detailed, height, add);
  if (lid !== "none") {
    const angle = lid === "open" ? -1.93 : 0;
    const hingeZ = -depth / 2, hingeY = height + .003;
    const lidTransform = new Matrix4().makeTranslation(0, hingeY, hingeZ)
      .multiply(new Matrix4().makeRotationX(angle));
    const moveLidGeometry = (size: Point, position: Point, surface: Surface) => {
      const start = groups.get(surface)?.length ?? 0;
      beam(size, position, surface);
      groups.get(surface)![start]!.applyMatrix4(lidTransform);
    };
    for (let board = 0; board < 5; board++) moveLidGeometry([width / 5 - .001, .022, depth + .012],
      [(board - 2) * width / 5, .011, depth / 2], "wood");
    // Two underside battens join all five long lid boards and connect them to the hinged pair.
    for (const z of [.07, depth - .07])
      moveLidGeometry([width - .05, .014, .030], [0, -.006, z], "wood");
    for (const x of [-.17, .17]) moveLidGeometry([.025, .006, depth + .012], [x, .025, depth / 2], "iron");
    for (const x of [-.17, .17]) {
      const hinge = new CylinderGeometry(.010, .010, .048, detailed ? 10 : 6);
      add(hinge, "iron", [x, hingeY, hingeZ], [0, 0, Math.PI / 2]);
    }
  }
  // Cheap continuous stack sides represent covered discs down to the real floor. Omitting these
  // made the exposed upper coins look suspended when viewed through the narrow column gaps.
  const addCoveredStackSides = () => {
    const first = new Map<number, typeof visible[number]>();
    for (const coin of visible) if (!first.has(coin.column)) first.set(coin.column, coin);
    for (const coin of first.values()) {
      if (!coin.layer) continue;
      const stackHeight = coin.layer * CHEST_COIN_THICKNESS;
      const radius = CHEST_COIN_DIAMETER / 2 - .0002;
      const geometry = new CylinderGeometry(radius, radius, stackHeight, detailed ? 12 : 8, 1, true);
      const position = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
      for (let index = 0; index < position.count; index++)
        uv.setY(index, (position.getY(index) + stackHeight / 2) / CHEST_COIN_THICKNESS);
      add(geometry, "gold", [coin.x, COIN_CHEST.floor + stackHeight / 2, coin.z]);
    }
  };
  // Reuse the original single coin's disc, gold tint and authored ship-emblem face. Hidden lower
  // coins remain in packing/count but are not drawn. Closed transport lids hide the whole pile.
  if (lid !== "closed") {
    addCoveredStackSides();
    const coinParts = createWareRecipe("coins", detailed).parts;
    for (const part of coinParts) {
      if (part.surface === "paint" && part.position[1] < 0) continue;
      const source = new CylinderGeometry(.5, .5, 1, detailed ? 12 : 8);
      // The original coin is the same cylinder/face recipe. Only wholly covered lower caps and
      // paper-thin face sides are omitted in this repeated bulk representation.
      const indices = Array.from(source.index!.array);
      const keep = source.groups.filter(group => group.materialIndex === 1 ||
        part.surface !== "paint" && group.materialIndex === 0);
      source.setIndex(keep.flatMap(group => indices.slice(group.start, group.start + group.count)));
      source.scale(...part.size); source.translate(...part.position);
      const colours = new Float32Array(source.getAttribute("position").count * 3);
      for (let index = 0; index < colours.length; index++) colours[index] = (part.tint ?? [1, 1, 1])[index % 3]!;
      source.setAttribute("color", new Float32BufferAttribute(colours, 3));
      source.scale(COIN_CHEST.coinScale, COIN_CHEST.coinScale, COIN_CHEST.coinScale);
      for (const coin of visible) {
        const matrix = new Matrix4().compose(new Vector3(coin.x, coin.y, coin.z),
          new Quaternion().setFromEuler(new Euler(coin.pitch, coin.yaw, coin.roll)), new Vector3(1, 1, 1));
        const geometry = source.clone().applyMatrix4(matrix);
        add(geometry, part.surface === "paint" ? "face" : "gold", [0, 0, 0]);
      }
      source.dispose();
    }
  }
  let triangles = 0;
  for (const [surface, parts] of groups) {
    const geometry = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    if (!geometry) throw new Error("Unable to merge coin chest surface");
    triangles += geometry.getAttribute("position").count / 3;
    const mesh = new Mesh(geometry, surfaces[surface]); mesh.name = surface;
    mesh.castShadow = detailed; mesh.receiveShadow = true; root.add(mesh);
  }
  let disposed = false, materialsDisposed = false;
  const disposeMaterials = () => {
    if (materialsDisposed) return;
    materialsDisposed = true;
    face?.release(); materials.dispose();
  };
  root.userData.sharedWareMaterials = true;
  root.userData.disposeOwnedMaterials = disposeMaterials;
  return { packing, root, triangles, visualCoins: lid === "closed" ? 0 : visible.length,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      root.traverse(child => { if (child instanceof Mesh) child.geometry.dispose(); });
      root.clear(); root.removeFromParent(); disposeMaterials();
    } };
};
