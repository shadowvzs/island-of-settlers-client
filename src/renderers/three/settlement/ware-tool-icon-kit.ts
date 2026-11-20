import {
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Material,
  Mesh,
  MeshStandardMaterial,
  Path,
  Shape,
  SphereGeometry,
  TorusGeometry
} from "three";

/** Shared materials and mesh helpers of the icon-only tool models (ware-tool-icon-*.ts). */

export type Point = readonly [number, number];
export type Surfaces = ReturnType<typeof createSurfaces>;

export const createSurfaces = () => ({
  brass: new MeshStandardMaterial({ color: "#c99a45", metalness: 0.85, roughness: 0.3 }),
  cork: new MeshStandardMaterial({ color: "#c08a52", roughness: 0.92 }),
  darkWood: new MeshStandardMaterial({ color: "#5b3a20", roughness: 0.62 }),
  edge: new MeshStandardMaterial({ color: "#f1f4f6", metalness: 1, roughness: 0.16 }),
  enamel: new MeshStandardMaterial({ color: "#c0201a", roughness: 0.32 }),
  glow: new MeshStandardMaterial({
    color: "#ff7a1a",
    emissive: "#ff4a00",
    emissiveIntensity: 1.6,
    roughness: 0.5
  }),
  iron: new MeshStandardMaterial({ color: "#6f777e", metalness: 0.7, roughness: 0.38 }),
  leather: new MeshStandardMaterial({ color: "#6b3b20", roughness: 0.7 }),
  maple: new MeshStandardMaterial({ color: "#dcae72", roughness: 0.55 }),
  steel: new MeshStandardMaterial({ color: "#dfe6eb", metalness: 0.72, roughness: 0.26 }),
  wood: new MeshStandardMaterial({ color: "#a06a38", roughness: 0.58 })
});

export const trace = <T extends Path>(points: readonly Point[], target: T) => {
  points.forEach(([x, y], index) => (index ? target.lineTo(x, y) : target.moveTo(x, y)));
  target.closePath();
  return target;
};

export const outline = (points: readonly Point[]) => trace(points, new Shape());

export const extrude = (shape: Shape, depth: number, bevel = depth * 0.35) => {
  const geometry = new ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 24,
    depth
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
};

export const place = (
  parent: Group,
  geometry: BufferGeometry,
  surface: Material | Material[],
  position: Point | number[]
) => {
  const mesh = new Mesh(geometry, surface);
  mesh.position.set(position[0]!, position[1]!, position[2] ?? 0);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
};

/** A turned wooden handle along Y with a darker band at both ends. */
export const addHandle = (
  parent: Group,
  surfaces: Surfaces,
  length: number,
  radius: number,
  centerY: number
) => {
  place(parent, new CylinderGeometry(radius * 0.9, radius, length, 20), surfaces.wood, [
    0,
    centerY
  ]);
  for (const end of [-1, 1]) {
    const band = place(
      parent,
      new TorusGeometry(radius * 0.98, radius * 0.22, 8, 20),
      surfaces.darkWood,
      [0, centerY + end * (length / 2 - radius * 0.6)]
    );
    band.rotation.x = Math.PI / 2;
  }
};

/** Leather grip: `turns` stacked rings around a Y handle, starting at `fromY`. */
export const addGripWrap = (
  parent: Group,
  surface: Material,
  radius: number,
  fromY: number,
  turns: number
) => {
  for (let wrap = 0; wrap < turns; wrap++) {
    const turn = place(parent, new TorusGeometry(radius, 0.01, 6, 18), surface, [
      0,
      fromY + wrap * 0.036
    ]);
    turn.rotation.x = Math.PI / 2;
  }
};

export const addRivet = (
  parent: Group,
  surface: Material,
  x: number,
  y: number,
  radius: number,
  depth: number
) => {
  for (const side of [-1, 1]) {
    const head = place(
      parent,
      new SphereGeometry(radius, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      surface,
      [x, y, side * depth]
    );
    head.rotation.x = (side * Math.PI) / 2;
  }
};
