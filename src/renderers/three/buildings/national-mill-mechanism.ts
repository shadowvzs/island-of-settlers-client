import {
  BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute,
  Group, Mesh, type MeshStandardMaterial
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import { ROMAN_MILL_ROTOR_SCALE } from "../../../render-common/buildings/roman-mill-dimensions";
import type { WorkerNation } from "../../../render-common/workers/worker-nation";
import { createFinishedMillSail, createStraightMillSail } from "./mill-sail-finish";
import { createNationalMillSailTexture } from "./national-mill-sail-texture";
import { createRomanMillMechanism } from "./roman-mill-mechanism";

type SailPoint = readonly [number, number];
interface RotorDesign {
  arms: number;
  outline: readonly SailPoint[];
  ribs: number;
  surface: BuildingSurface;
  tint: readonly [number, number, number];
}

/** Shared swept radius and axle; separate invented mechanisms suited to each architectural theme. */
const DESIGNS: Readonly<Record<Exclude<WorkerNation, "roman">, RotorDesign>> = {
  viking: { arms: 4, outline: [[-.18, .68], [.22, .68], [.22, 1.91], [-.18, 1.91]],
    ribs: 9, surface: "cloth", tint: [1, 1, 1] },
  japanese: { arms: 6, outline: [[0, .35], [.33, 1.85], [-.11, 1.94]],
    ribs: 4, surface: "cloth", tint: [.87, .82, .66] },
  nubian: { arms: 8, outline: [[0, .40], [.28, .85], [.38, 1.5], [.19, 1.92], [-.14, 1.68], [-.08, 1.1]],
    ribs: 2, surface: "cloth", tint: [1, 1, 1] },
  chinese: { arms: 6, outline: [[-.05, .42], [.25, 1.28], [.30, 1.87], [-.22, 1.93], [-.16, 1.1]],
    ribs: 7, surface: "cloth", tint: [1, 1, 1] },
  persian: { arms: 6, outline: [[-.07, .45], [.12, .45], [.42, 1.45], [.22, 1.88], [-.24, 1.88], [-.36, 1.4]],
    ribs: 2, surface: "cloth", tint: [1, 1, 1] },
  maya: { arms: 4, outline: [[-.09, .46], [.12, .46], [.35, 1.87], [-.33, 1.87]],
    ribs: 8, surface: "cloth", tint: [1, 1, 1] },
  indigenous: { arms: 5, outline: [[-.07, .34], [.17, .45], [.42, 1.40], [.23, 1.91], [-.33, 1.77]],
    ribs: 2, surface: "cloth", tint: [.92, .83, .66] }
};

/** The entire rotor turns together, so each material needs one draw call rather than one per rib. */
const batchRotor = (root: Group, owned: ReadonlySet<MeshStandardMaterial>, detailed: boolean) => {
  const groups = new Map<MeshStandardMaterial, BufferGeometry[]>();
  root.updateMatrixWorld(true);
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const material = object.material as MeshStandardMaterial;
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    const selected = groups.get(material) ?? [];
    selected.push(geometry); groups.set(material, selected);
    object.geometry.dispose();
  });
  root.clear();
  for (const [material, geometries] of groups) {
    const geometry = mergeGeometries(geometries);
    geometries.forEach(part => part.dispose());
    if (!geometry) throw new Error("National mill rotor geometry merge failed");
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = detailed;
    if (owned.has(material)) {
      mesh.userData.ownedMaterial = true;
      if (material.userData.ownedMap) mesh.userData.ownedMap = true;
    }
    root.add(mesh);
  }
};

/** Follow the actual fan outline instead of letting rectangular ribs protrude past triangular cloth. */
const ribSpan = (outline: readonly SailPoint[], height: number) => {
  const intersections: number[] = [];
  outline.forEach(([x, y], index) => {
    const [nextX, nextY] = outline[(index + 1) % outline.length]!;
    if (height < Math.min(y, nextY) || height > Math.max(y, nextY) || y === nextY) return;
    intersections.push(x + (nextX - x) * (height - y) / (nextY - y));
  });
  const left = Math.min(...intersections), right = Math.max(...intersections);
  return { centre: (left + right) / 2, width: Math.max(.02, right - left - .016) };
};

export const createNationalMillMechanism = (materials: Record<BuildingSurface, MeshStandardMaterial>,
  detailed: boolean, nation: WorkerNation) => {
  if (nation === "roman") return createRomanMillMechanism(materials, detailed);
  const design = DESIGNS[nation], root = new Group();
  root.name = "mechanism";
  const mesh = (geometry: BufferGeometry, material: MeshStandardMaterial, parent = root) => {
    geometry.setAttribute("color", new Float32BufferAttribute(
      new Float32Array(geometry.getAttribute("position").count * 3).fill(1), 3));
    const object = new Mesh(geometry, material);
    object.castShadow = detailed;
    parent.add(object);
    return object;
  };
  const hub = mesh(new CylinderGeometry(.11, .14, .16, detailed ? 12 : 6), materials.wood);
  hub.rotation.x = Math.PI / 2;
  const cap = mesh(new CylinderGeometry(.065, .065, .04, detailed ? 12 : 6), materials.iron);
  cap.rotation.x = Math.PI / 2; cap.position.z = .085;
  const covering = materials[design.surface].clone();
  covering.color.setRGB(...design.tint);
  covering.map = createNationalMillSailTexture(nation, detailed, design.outline);
  covering.userData.ownedMap = true;
  covering.normalMap = null; covering.roughnessMap = null; covering.roughness = .96;
  covering.bumpMap = detailed ? covering.map : null;
  covering.bumpScale = .003;
  covering.color.setRGB(1, 1, 1);
  const owned = new Set([covering]);
  let ribsMaterial = materials.wood;
  if (nation === "japanese") {
    ribsMaterial = materials.wood.clone(); ribsMaterial.color.setRGB(.55, .43, .24);
    ribsMaterial.roughness = .92; owned.add(ribsMaterial);
  }
  if (nation === "chinese") {
    ribsMaterial = materials.wood.clone(); ribsMaterial.color.setRGB(.48, .11, .075);
    ribsMaterial.roughness = .88; owned.add(ribsMaterial);
  }
  for (let index = 0; index < design.arms; index++) {
    const wing = new Group(); wing.rotation.z = -index * Math.PI * 2 / design.arms;
    root.add(wing);
    const arm = mesh(new BoxGeometry(.035, 1.94, .035), materials.wood, wing);
    arm.position.set(0, .97, .025);
    const finished = nation === "viking" ? createStraightMillSail(design.outline) : createFinishedMillSail(design.outline, detailed);
    const panelOutline = finished.outline;
    const sail = mesh(finished.geometry, covering, wing);
    sail.position.z = .05; sail.name = `mill_${nation}_sail_${index}`;
    if (index === 0) sail.userData.ownedMaterial = true;
    const ribs = detailed ? design.ribs : Math.max(2, Math.ceil(design.ribs / 2));
    const ribTop = nation === "viking" ? 1.83 : Math.min(1.83, Math.max(...panelOutline.map(point => point[1])) - .035);
    for (let rib = 0; rib < ribs; rib++) {
      const y = .78 + rib * (ribTop - .78) / Math.max(1, ribs - 1);
      const span = ribSpan(panelOutline, y);
      const batten = mesh(new BoxGeometry(span.width, .018, .02), ribsMaterial, wing);
      batten.position.set(span.centre, y, .068);
    }
    if (nation === "indigenous" || nation === "maya") {
      const band = mesh(new BoxGeometry(.25, .08, .012), materials.paint, wing);
      band.position.set(0, 1.57, .077);
    }
  }
  // Bake the dimensions: construction clips own mechanism.scale and must finish at unit scale.
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    object.geometry.scale(ROMAN_MILL_ROTOR_SCALE, ROMAN_MILL_ROTOR_SCALE, ROMAN_MILL_ROTOR_SCALE);
    object.position.multiplyScalar(ROMAN_MILL_ROTOR_SCALE);
  });
  batchRotor(root, owned, detailed);
  return root;
};
