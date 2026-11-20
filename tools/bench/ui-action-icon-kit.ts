import {
  BufferGeometry,
  CanvasTexture,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  type Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Object3D,
  Shape,
  SRGBColorSpace
} from "three";

/** Shared materials, painted textures and mesh helpers for the offline UI action icon renders. */
export type Paint = (context: CanvasRenderingContext2D, width: number, height: number) => void;
export type Vec = readonly number[];

export const surfaces = {
  brass: new MeshStandardMaterial({ color: "#d6a84f", metalness: 0.85, roughness: 0.28 }),
  bronze: new MeshStandardMaterial({ color: "#b8793a", metalness: 0.8, roughness: 0.32 }),
  cloud: new MeshStandardMaterial({ color: "#f4f6f8", roughness: 0.9 }),
  darkWood: new MeshStandardMaterial({ color: "#4f311b", roughness: 0.62 }),
  enamel: new MeshPhysicalMaterial({
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    color: "#a8170f",
    roughness: 0.3
  }),
  glass: new MeshPhysicalMaterial({
    clearcoat: 1,
    color: "#9fd4ff",
    metalness: 0.2,
    roughness: 0.05
  }),
  gold: new MeshStandardMaterial({
    color: "#f0c25a",
    emissive: "#3d2604",
    metalness: 0.85,
    roughness: 0.24
  }),
  grass: new MeshStandardMaterial({ color: "#447f28", roughness: 0.9 }),
  iron: new MeshStandardMaterial({ color: "#636b74", metalness: 0.8, roughness: 0.38 }),
  leather: new MeshStandardMaterial({ color: "#7a4424", roughness: 0.7 }),
  paper: new MeshStandardMaterial({ color: "#efdcae", roughness: 0.85 }),
  rain: new MeshPhysicalMaterial({ clearcoat: 1, color: "#4aa3e0", roughness: 0.1 }),
  sack: new MeshStandardMaterial({ color: "#b48f58", roughness: 0.95 }),
  soil: new MeshStandardMaterial({ color: "#6e4a2c", roughness: 0.95 }),
  steel: new MeshStandardMaterial({ color: "#dfe6eb", metalness: 0.75, roughness: 0.24 }),
  stone: new MeshStandardMaterial({ color: "#8c8577", flatShading: true, roughness: 0.85 }),
  sun: new MeshStandardMaterial({
    color: "#ffcf4a",
    emissive: "#ff9a1a",
    emissiveIntensity: 0.7,
    roughness: 0.4
  }),
  wax: new MeshStandardMaterial({ color: "#a3241e", metalness: 0.1, roughness: 0.35 }),
  wood: new MeshStandardMaterial({ color: "#a06a38", roughness: 0.6 })
};

export const paintedMaterial = (width: number, height: number, paint: Paint, roughness = 0.75) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext("2d")!, width, height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return new MeshStandardMaterial({ map: texture, roughness });
};

/** Adds a mesh to a parent at a position with an optional XYZ Euler rotation. */
export const put = (
  parent: Object3D,
  geometry: BufferGeometry,
  surface: Material | Material[],
  position: Vec = [0, 0, 0],
  rotation: Vec = [0, 0, 0]
) => {
  const mesh = new Mesh(geometry, surface);
  mesh.position.set(position[0]!, position[1]!, position[2]!);
  mesh.rotation.set(rotation[0]!, rotation[1]!, rotation[2]!);
  parent.add(mesh);
  return mesh;
};

export const group = (parent: Object3D, position: Vec = [0, 0, 0], rotation: Vec = [0, 0, 0]) => {
  const result = new Group();
  result.position.set(position[0]!, position[1]!, position[2]!);
  result.rotation.set(rotation[0]!, rotation[1]!, rotation[2]!);
  parent.add(result);
  return result;
};

export const polygon = (points: readonly (readonly [number, number])[]) => {
  const shape = new Shape();
  points.forEach(([x, y], index) => (index ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  return shape;
};

/** Centred extrusion along Z with a rounded bevel. */
export const slab = (shape: Shape, depth: number, bevel = depth * 0.3) => {
  const geometry = new ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 4,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 32,
    depth
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
};

/** A lumpy rock: an icosphere displaced by layered sines, flat shaded. */
export const rockGeometry = (seed: number, detail = 1) => {
  const geometry = new IcosahedronGeometry(1, detail);
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index),
      y = position.getY(index),
      z = position.getZ(index);
    const relief =
      1 +
      0.16 * Math.sin(x * 5 + seed) * Math.cos(z * 4 + seed) +
      0.08 * Math.sin(y * 7 + seed * 2);
    position.setXYZ(index, x * relief, y * relief, z * relief);
  }
  geometry.computeVertexNormals();
  return geometry;
};

/** Fired bricks: a darker lower course line and a lighter weathered face. */
export const brickMaterial = () =>
  paintedMaterial(64, 32, (context, width, height) => {
    context.fillStyle = "#8e3a1f";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#a9492a";
    context.fillRect(2, 2, width - 4, height - 6);
    context.fillStyle = "#bf6038";
    context.fillRect(4, 4, width - 12, height / 2 - 4);
  });

/** Grass-topped earth tile; the top face takes an optional painted texture. */
export const tileSurfaces = (top: Material = surfaces.grass) => [
  surfaces.soil,
  surfaces.soil,
  top,
  surfaces.soil,
  surfaces.soil,
  surfaces.soil
];

export const disposeTree = (root: Object3D) => {
  const owned = new Set<Material>(),
    shared = new Set<Material>(Object.values(surfaces));
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    for (const material of [object.material].flat()) if (!shared.has(material)) owned.add(material);
  });
  owned.forEach((material) => {
    (material as MeshStandardMaterial).map?.dispose();
    material.dispose();
  });
};
