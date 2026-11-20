import {
type BufferGeometry,
  CanvasTexture, CatmullRomCurve3, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group,
  InstancedMesh, LatheGeometry,   type Material,
Matrix4, Mesh, MeshPhysicalMaterial, Quaternion, RepeatWrapping,
  SphereGeometry, SRGBColorSpace, TorusGeometry, TubeGeometry, Vector2, Vector3} from "three";

/** Shared geometry and material helpers of the race helmet icon renders (browser module). */

export type Profile = readonly (readonly [radius: number, height: number])[];

export const metal = (color: string, roughness: number, metalness = 1) =>
  new MeshPhysicalMaterial({ clearcoat: 0.25, clearcoatRoughness: 0.3, color, metalness, roughness });

export const lacquer = (color: string) =>
  new MeshPhysicalMaterial({ clearcoat: 1, clearcoatRoughness: 0.08, color, metalness: 0.1, roughness: 0.42 });

export const matte = (color: string, roughness = 0.8) =>
  new MeshPhysicalMaterial({ color, roughness, side: DoubleSide });

/** Smooth bowl turned around the vertical axis from a (radius, height) profile. */
export const turn = (profile: Profile, material: Material, segments = 96) => {
  const points = profile.map(([radius, height]) => new Vector2(radius, height));
  return new Mesh(new LatheGeometry(points, segments), material);
};

/** Point on a turned profile at a height fraction, around the axis at `angle`, pushed out by `lift`. */
export const profilePoint = (profile: Profile, fraction: number, angle: number, lift = 0) => {
  const scaled = fraction * (profile.length - 1);
  const index = Math.min(profile.length - 2, Math.floor(scaled));
  const blend = scaled - index;
  const [radiusA, heightA] = profile[index]!;
  const [radiusB, heightB] = profile[index + 1]!;
  const radius = radiusA + (radiusB - radiusA) * blend + lift;
  return new Vector3(Math.sin(angle) * radius, heightA + (heightB - heightA) * blend, Math.cos(angle) * radius);
};

/** Metal rib running up a bowl profile at one angle, from `from` to `to` (height fractions). */
export const rib = (profile: Profile, angle: number, material: Material, radius: number, from = 0, to = 1) => {
  const points = Array.from({ length: 24 }, (_, index) =>
    profilePoint(profile, from + (to - from) * index / 23, angle, radius * 0.6));
  return new Mesh(new TubeGeometry(new CatmullRomCurve3(points), 64, radius, 8), material);
};

/**
 * Horizontal ring (band edge, rim) at a height; a partial `arc` is centred on `centre` (0: front, PI: back).
 */
export const ring = (radius: number, tube: number, height: number, material: Material, arc = Math.PI * 2,
  centre = 0) => {
  const mesh = new Mesh(new TorusGeometry(radius, tube, 12, 128, arc), material);
  mesh.rotation.set(-Math.PI / 2, 0, centre - Math.PI / 2 - arc / 2);
  mesh.position.y = height;
  return mesh;
};

/** Open band (partial cone) between two radii; `start` / `length` select the arc around the axis. */
export const band = (options: {
  bottom: number; height: number; length?: number; material: Material; start?: number; top: number; y: number;
}) => {
  const { bottom, height, length = Math.PI * 2, material, start = 0, top, y } = options;
  const mesh = new Mesh(new CylinderGeometry(top, bottom, height, 128, 4, true, start, length), material);
  mesh.position.y = y;
  return mesh;
};

/** Rivet heads spread around a ring. */
export const rivets = (options: {
  count: number; from?: number; material: Material; radius: number; size: number; to?: number; y: number;
}) => {
  const { count, from = 0, material, radius, size, to = Math.PI * 2, y } = options;
  const group = new Group();
  const geometry = new SphereGeometry(size, 12, 8);
  for (let index = 0; index < count; index++) {
    const angle = from + (to - from) * (index + 0.5) / count;
    const head = new Mesh(geometry, material);
    head.position.set(Math.sin(angle) * radius, y, Math.cos(angle) * radius);
    group.add(head);
  }
  return group;
};

/**
 * Tube along a curve whose radius follows `radiusAt(t)` (horns, plume shafts); optional vertex colours
 * from `colorAt(t)`.
 */
export const taperedTube = (options: {
  colorAt?: (t: number) => Color; material: Material; points: Vector3[]; radiusAt: (t: number) => number;
}) => {
  const { colorAt, material, points, radiusAt } = options;
  const curve = new CatmullRomCurve3(points);
  const tubular = 96, radial = 24;
  const geometry = new TubeGeometry(curve, tubular, 1, radial);
  const position = geometry.getAttribute("position");
  const colors: number[] = [];
  for (let index = 0; index < position.count; index++) {
    const t = Math.floor(index / (radial + 1)) / tubular;
    const centre = curve.getPointAt(t);
    const vertex = new Vector3().fromBufferAttribute(position, index).sub(centre).multiplyScalar(radiusAt(t));
    position.setXYZ(index, centre.x + vertex.x, centre.y + vertex.y, centre.z + vertex.z);
    if (colorAt) colors.push(...colorAt(t).toArray());
  }
  if (colorAt) geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return new Mesh(geometry, material);
};

/** Many thin tapered strands (horsehair), one instanced draw with per strand colour. */
export const strands = (options: {
  count: number; material: Material; place: (index: number, random: () => number) => {
    color: Color; direction: Vector3; length: number; origin: Vector3; width: number;
  };
}) => {
  const { count, material, place } = options;
  const geometry = new CylinderGeometry(0.35, 1, 1, 6, 1);
  geometry.translate(0, 0.5, 0);
  const mesh = new InstancedMesh(geometry, material, count);
  const random = seeded(7);
  const up = new Vector3(0, 1, 0);
  for (let index = 0; index < count; index++) {
    const { color, direction, length, origin, width } = place(index, random);
    const rotation = new Quaternion().setFromUnitVectors(up, direction.clone().normalize());
    mesh.setMatrixAt(index, new Matrix4().compose(origin, rotation, new Vector3(width, length, width)));
    mesh.setColorAt(index, color);
  }
  return mesh;
};

/** Small deterministic random generator, so every render of the icons is identical. */
export const seeded = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
};

/** Canvas texture drawn once by `paint` (lacing, hide, feathers). */
export const paintedTexture = (width: number, height: number, paint: (context: CanvasRenderingContext2D) => void,
  repeat = 1) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext("2d")!);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.repeat.set(repeat, 1);
  texture.anisotropy = 8;
  return texture;
};

/** Bends a flat geometry: `move` maps each vertex (x, y, z) to its new place. */
export const bend = (geometry: BufferGeometry, move: (vertex: Vector3) => Vector3) => {
  const position = geometry.getAttribute("position");
  const vertex = new Vector3();
  for (let index = 0; index < position.count; index++) {
    const moved = move(vertex.fromBufferAttribute(position, index));
    position.setXYZ(index, moved.x, moved.y, moved.z);
  }
  geometry.computeVertexNormals();
  return geometry;
};
