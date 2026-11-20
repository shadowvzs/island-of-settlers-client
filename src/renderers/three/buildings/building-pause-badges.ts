import {
  BoxGeometry, type Camera,
CylinderGeometry, Group, InstancedMesh, MeshStandardMaterial,
  Object3D, Quaternion, TorusGeometry} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { BuildingLevel } from "../../../render-common/buildings/levels/building-level";
import { buildingLevelDigitParts } from "./building-level-digits";

export interface BuildingPauseMarker { x: number; y: number; z: number; phase: number }

/** Two shared draw calls for every visible pause badge, including Minimal. */
export const createBuildingPauseBadges = (detailed: boolean, kind: "pause" | BuildingLevel = "pause") => {
  const root = new Group();
  root.name = `building_${kind}_badges`;
  const discGeometry = new CylinderGeometry(.24, .24, .055, detailed ? 32 : 12).rotateX(Math.PI / 2);
  const parts = [
    new TorusGeometry(.22, .018, detailed ? 6 : 3, detailed ? 32 : 12).translate(0, 0, .035),
    ...(kind === "pause"
      ? [-1, 1].map(side => new BoxGeometry(.046, .23, .032).translate(side * .065, 0, .045))
      : buildingLevelDigitParts(kind))
  ];
  const detailGeometry = mergeGeometries(parts)!;
  parts.forEach(geometry => geometry.dispose());
  const bronze = new MeshStandardMaterial({ color: "#785029", metalness: .65, roughness: .36 });
  const gold = new MeshStandardMaterial({ color: "#efc475", emissive: "#ae7326",
    emissiveIntensity: .3, metalness: .55, roughness: .28 });
  let capacity = 16;
  let discs = new InstancedMesh(discGeometry, bronze, capacity);
  let details = new InstancedMesh(detailGeometry, gold, capacity);
  root.add(discs, details);
  let markers: readonly BuildingPauseMarker[] = [];
  let time = 0;
  const transform = new Object3D(), facing = new Quaternion();
  const update = (next: readonly BuildingPauseMarker[], seconds: number) => {
    markers = next; time = seconds;
    if (markers.length <= capacity) return;
    while (capacity < markers.length) capacity *= 2;
    root.remove(discs, details); discs.dispose(); details.dispose();
    discs = new InstancedMesh(discGeometry, bronze, capacity);
    details = new InstancedMesh(detailGeometry, gold, capacity);
    root.add(discs, details);
  };
  const faceCamera = (camera: Camera) => {
    camera.getWorldQuaternion(facing);
    for (let index = 0; index < markers.length; index++) {
      const marker = markers[index]!;
      transform.position.set(marker.x, marker.y + Math.sin(time * 1.8 + marker.phase) * .08, marker.z);
      transform.quaternion.copy(facing); transform.updateMatrix();
      discs.setMatrixAt(index, transform.matrix); details.setMatrixAt(index, transform.matrix);
    }
    for (const mesh of [discs, details]) {
      mesh.count = markers.length; mesh.visible = markers.length > 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.needsUpdate = true;
    }
    gold.emissiveIntensity = .22 + (Math.sin(time * 1.8) + 1) * .12;
  };
  return { root, update, faceCamera, dispose: () => {
    discs.dispose(); details.dispose(); discGeometry.dispose(); detailGeometry.dispose();
    bronze.dispose(); gold.dispose(); root.removeFromParent();
  } };
};
