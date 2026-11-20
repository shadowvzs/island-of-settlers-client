import {
  BoxGeometry,   type BufferGeometry, CylinderGeometry, Float32BufferAttribute, Group, Mesh,
type MeshStandardMaterial, TorusGeometry
} from "three";

import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import type { WorkerNation } from "../../../render-common/workers/worker-nation";
import { createHollowRingGeometry } from "./roman-hollow-ring";

/** The same original handled bucket is suspended from the well and carried away by its operator. */
const getBucketRingSegments = (detailed: boolean, compactStock: boolean) => {
  if (detailed) return 16;
  return compactStock ? 4 : 8;
};
const bucketFloorRadius = (nation: WorkerNation) => {
  if (nation === "nubian") return .071;
  return nation === "japanese" ? .075 : .085;
};
const bucketWaterSegments = (nation: WorkerNation, detailed: boolean, compact: boolean, segments: number) => {
  if (nation === "nubian") return segments;
  return !detailed && compact ? 4 : 12;
};

const tintNubianBucket = (geometry: BufferGeometry, nation: WorkerNation) => {
  if (nation !== "nubian") return;
  const colors = geometry.getAttribute("color");
  for (let index = 0; index < colors.count; index++) colors.setXYZ(index, .36, .2, .09);
};

export const createRomanDrawBucket = (
  materials: Record<BuildingSurface, MeshStandardMaterial>,
  waterMaterial: MeshStandardMaterial,
  detailed: boolean, compactStock = false, nation: WorkerNation = "roman"
) => {
  const root = new Group();
  root.name = "well_bucket";
  const mesh = (geometry: BufferGeometry, material: MeshStandardMaterial) => {
    geometry.setAttribute("color", new Float32BufferAttribute(
      new Float32Array(geometry.getAttribute("position").count * 3).fill(1), 3
    ));
    const object = new Mesh(geometry, material);
    object.castShadow = detailed;
    root.add(object);
    return object;
  };
  const nationalSegments = { roman: getBucketRingSegments(detailed, compactStock), viking: 8,
    japanese: 4, nubian: detailed ? 16 : 12, chinese: detailed ? 12 : 6, persian: detailed ? 16 : 8,
    maya: detailed ? 10 : 5, indigenous: 6 }[nation];
  const body = createHollowRingGeometry(nationalSegments);
  const square = nation === "japanese";
  body.scale(square ? .254558 : .18, .14, square ? .254558 : .18);
  if (square) body.rotateY(Math.PI / 4);
  if (nation !== "roman") {
    const positions = body.getAttribute("position");
    for (let index = 0; index < positions.count; index++) {
      const y = positions.getY(index), t = (y + .07) / .14;
      let taper = .8 + t * .2;
      if (nation === "maya") taper = .86 + Math.sin(t * Math.PI) * .14;
      if (nation === "indigenous") taper = .72 + t * .28;
      positions.setXYZ(index, positions.getX(index) * taper, y, positions.getZ(index) * taper);
    }
    body.computeVertexNormals();
  }
  const bodySurfaces: Partial<Record<WorkerNation, BuildingSurface>> = { persian: "copper", nubian: "paint" };
  const bodySurface = bodySurfaces[nation] ?? "wood";
  const bodyMesh = mesh(body, materials[bodySurface]);
  bodyMesh.name = `well_${nation}_bucket_body`;
  tintNubianBucket(body, nation);
  const romanFloorSegments = !detailed && compactStock ? 4 : 12;
  const floorRadius = bucketFloorRadius(nation);
  const floor = mesh(new CylinderGeometry(floorRadius, floorRadius, .018,
    nation === "roman" ? romanFloorSegments : nationalSegments),
  materials[bodySurface]); floor.position.y = -.065;
  tintNubianBucket(floor.geometry, nation);
  if (nation !== "roman") {
    const bindingSurfaces: Partial<Record<WorkerNation, BuildingSurface>> = { viking: "iron", persian: "copper" };
    const bindingSurface = bindingSurfaces[nation] ?? "rope";
    for (const y of detailed ? [-.047, .052] : [.052]) {
      const band = mesh(new TorusGeometry((y < 0 ? .075 : .084) * (square ? Math.SQRT2 : 1), .005, detailed ? 4 : 3,
        square ? 4 : nationalSegments), materials[bindingSurface]);
      band.rotation.x = Math.PI / 2;
      if (square) band.rotation.z = Math.PI / 4;
      band.position.y = y;
    }
  }
  if (nation === "nubian") {
    const bail = mesh(new TorusGeometry(.07, .005, detailed ? 4 : 3, nationalSegments, Math.PI), materials.rope);
    bail.name = "well_nubian_bucket_bail"; bail.position.y = .081;
    for (const side of [-1, 1]) mesh(new CylinderGeometry(.008, .008, .012, detailed ? 8 : 6), materials.rope)
      .position.set(side * .07, .075, 0);
  } else {
    for (const side of [-1, 1])
      mesh(new BoxGeometry(.01, .13, .01), materials[nation === "roman" || nation === "persian" ? "iron" : "rope"])
        .position.set(side * .07, .09, 0);
    mesh(new BoxGeometry(.15, .012, .012), materials[nation === "roman" || nation === "persian" ? "iron" : "wood"]).position.y = .15;
  }
  const waterSegments = bucketWaterSegments(nation, detailed, compactStock, nationalSegments);
  const water = mesh(new CylinderGeometry(nation === "roman" ? .064 : .058,
    nation === "roman" ? .064 : .058, .006, waterSegments), waterMaterial);
  water.name = "well_bucket_water";
  water.position.y = .035;
  return { root, water };
};
