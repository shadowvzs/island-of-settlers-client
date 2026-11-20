import {
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  type MeshStandardMaterial,
  TorusGeometry,
  VectorKeyframeTrack} from "three";

export const createWellChain = (steel: MeshStandardMaterial, wheel: Group, detailed: boolean) => {
  const root = new Group();
  root.name = "well_rope";
  root.position.set(0, -0.045, -0.06);
  const tracks: VectorKeyframeTrack[] = [],
    links: Mesh[] = [];
  const add = (geometry: TorusGeometry | CylinderGeometry, parent: Group) => {
    geometry.setAttribute(
      "color",
      new Float32BufferAttribute(
        new Float32Array(geometry.attributes.position!.count * 3).fill(1),
        3
      )
    );
    const object = new Mesh(geometry, steel);
    parent.add(object);
    return object;
  };
  const coilCount = detailed ? 40 : 1;
  for (let i = 0; i < coilCount; i++) {
    const angle = i * 0.25 - (coilCount - 1) * 0.25 - Math.PI / 2;
    const coil = add(
      new TorusGeometry(detailed ? 0.006 : 0.048, detailed ? 0.0018 : 0.003, 3, 6),
      wheel
    );
    if (detailed) {
      coil.position.set(
        0.56 - 0.08 + i * (0.08 / (coilCount - 1)),
        Math.sin(angle) * 0.048,
        Math.cos(angle) * 0.048
      );
      coil.rotation.set(angle, i % 2 ? Math.PI / 2 : 0, 0);
    } else {
      coil.position.x = 0.56;
      coil.rotation.y = Math.PI / 2;
    }
  }
  const rod = detailed ? undefined : add(new CylinderGeometry(0.005, 0.005, 1, 4), root);
  if (rod) {
    rod.name = "well_chain_minimal";
    const lengths = [0.045, 0.045, 0.495, 0.495, 0.045, 0.045];
    tracks.push(
      new VectorKeyframeTrack(
        `${rod.name}.scale`,
        [0, 1, 2, 12, 13, 14],
        lengths.flatMap((length) => [1, length, 1])
      )
    );
    tracks.push(
      new VectorKeyframeTrack(
        `${rod.name}.position`,
        [0, 1, 2, 12, 13, 14],
        lengths.flatMap((length) => [0, -length / 2, 0])
      )
    );
  } else
    for (let i = 0; i < 29; i++) {
      const link = add(new TorusGeometry(0.006, 0.0018, 3, 6), root);
      link.name = `well_chain_${i}`;
      link.position.y = -(i + 0.5) * 0.017;
      link.rotation.y = i % 2 ? Math.PI / 2 : 0;
      links.push(link);
      const distance = (i + 0.5) * 0.017;
      if (distance <= 0.045) continue;
      const lower = 1 + (distance - 0.045) / 0.45;
      const raise = 13 - (distance - 0.045) / 0.45;
      tracks.push(
        new VectorKeyframeTrack(
          `${link.name}.scale`,
          [0, lower - 0.01, lower, raise, raise + 0.01, 14],
          [
            0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 1, 1, 1, 1, 1, 1, 0.001, 0.001, 0.001, 0.001,
            0.001, 0.001
          ]
        )
      );
    }
  const update = (length: number) => {
    if (rod) {
      rod.scale.y = length;
      rod.position.y = -length / 2;
    }
    links.forEach((link, i) => link.scale.setScalar((i + 0.5) * 0.017 <= length ? 1 : 0.001));
  };
  return { root, tracks, update };
};
