import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

import type { Point3 } from "../../../render-common/buildings/building-recipe";
import { ornamentalNoise } from "../../../render-common/plants/ornamental-tree-graph";

/** Needles are closed green triangular blades, never pale crossed cards. */
export const createCatalogBonsaiNeedles = (at: Point3, angle: number, seed: number, detailed: boolean) => {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const count = detailed ? 7 : 5;
  for (let needle = 0; needle < count; needle++) {
    const yaw = angle + needle * 2.399963;
    const length = .053 + ornamentalNoise(seed + needle) * .029;
    const direction = new Vector3(Math.cos(yaw) * .8, .35 + ornamentalNoise(seed * 3 + needle),
      Math.sin(yaw) * .8).normalize();
    const across = direction.clone().cross(new Vector3(0, 1, 0)).normalize();
    const front = across.clone().cross(direction).normalize();
    const start = new Vector3(...at), offset = positions.length / 3;
    for (let corner = 0; corner < 3; corner++) {
      const radians = corner / 3 * Math.PI * 2;
      positions.push(...start.clone().addScaledVector(across, Math.cos(radians) * .0019)
        .addScaledVector(front, Math.sin(radians) * .0019).toArray());
      colors.push(.72, .89, .60);
    }
    positions.push(...start.clone().addScaledVector(direction, length).toArray());
    colors.push(.98, 1, .78);
    indices.push(offset, offset + 1, offset + 3, offset + 1, offset + 2, offset + 3,
      offset + 2, offset, offset + 3, offset + 2, offset + 1, offset);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
};

/** Five softly lobed petals form a genuine flared throat with depth and a scalloped outer rim. */
export const createCatalogAzaleaTrumpet = (at: Point3, yaw: number, seed: number, detailed: boolean, distant = false) => {
  let segments = detailed ? 20 : 10;
  if (distant) segments = 5;
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const axis = new Vector3(Math.sin(yaw) * .64, .72, Math.cos(yaw) * .64).normalize();
  const side = axis.clone().cross(new Vector3(0, 1, 0)).normalize();
  const across = axis.clone().cross(side).normalize();
  const size = .027 + ornamentalNoise(seed) * .009;
  for (let ring = 0; ring < 4; ring++) for (let sector = 0; sector <= segments; sector++) {
    const angle = sector / segments * Math.PI * 2, t = ring / 3;
    const lobe = .79 + .21 * Math.cos(angle * 5);
    const radius = size * (.10 + t * t * .94) * lobe;
    const p = new Vector3(...at).addScaledVector(axis, size * (t * 1.12 - t * t * .22))
      .addScaledVector(side, Math.cos(angle) * radius).addScaledVector(across, Math.sin(angle) * radius);
    positions.push(...p.toArray());
    const rim = .64 + t * .36, speck = ring === 2 && sector % 3 === 0 ? .66 : 1;
    colors.push(rim, (.55 + t * .45) * speck, .88 + t * .12);
    if (ring === 3 || sector === segments) continue;
    const a = ring * (segments + 1) + sector, b = a + segments + 1;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
};

/** Imbricate pointed scales on a tapered fernlike shoot, rather than broad deciduous blades. */
export const createCatalogJuniperSpray = (at: Point3, yaw: number, seed: number, detailed: boolean) => {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const forward = new Vector3(Math.cos(yaw), .30, Math.sin(yaw)).normalize();
  const side = new Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
  const start = new Vector3(...at), stations = detailed ? 5 : 3;
  const length = .057 + ornamentalNoise(seed) * .018;
  const scale = (base: Vector3, tip: Vector3, width: number, shade: number) => {
    const offset = positions.length / 3, middle = base.clone().lerp(tip, .35);
    positions.push(...base.toArray(), ...middle.clone().addScaledVector(side, width).toArray(),
      ...tip.toArray(), ...middle.clone().addScaledVector(side, -width).toArray(),
      ...middle.clone().add(new Vector3(0, width * .8, 0)).toArray());
    for (let vertex = 0; vertex < 5; vertex++) colors.push(shade * .82, shade, shade * .90);
    indices.push(offset, offset + 1, offset + 4, offset + 1, offset + 2, offset + 4,
      offset + 2, offset + 3, offset + 4, offset + 3, offset, offset + 4);
  };
  scale(start, start.clone().addScaledVector(forward, length), .0025, .78);
  for (let station = 0; station < stations; station++) for (const direction of [-1, 1]) {
    const t = .15 + station / stations * .72;
    const base = start.clone().addScaledVector(forward, length * t);
    const reach = .025 * (1 - t * .60);
    const tip = base.clone().addScaledVector(forward, reach * .65)
      .addScaledVector(side, direction * reach).add(new Vector3(0, .006, 0));
    scale(base, tip, .0035, .86 + ornamentalNoise(seed + station * 3) * .14);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
};
