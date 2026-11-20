import * as THREE from "three";

/**
 * Shared modelling kit of the game cursor set (tools/bench/cursors). Every model is authored in 1x cursor
 * pixels: x to the right, y downwards, so a hotspot is simply the pixel the tip sits on. `toScene` flips y
 * for three.js (the cursor camera looks at x 0..32, y 0..-32).
 */
export type Point = readonly [number, number];

export const CURSOR_PIXELS = 32;

/** The cursor set's palette: gilded bronze metal, enamel inlays, steel, oak and leather. */
export const createCursorMaterials = () => {
  const metal = (color: string, roughness: number) =>
    new THREE.MeshPhysicalMaterial({ color, envMapIntensity: 2, metalness: 1, roughness });
  const enamel = (color: string) =>
    new THREE.MeshStandardMaterial({ color, envMapIntensity: .12, metalness: 0, roughness: .38 });
  const matte = (color: string, roughness: number) =>
    new THREE.MeshStandardMaterial({ color, envMapIntensity: .35, metalness: 0, roughness });
  return {
    bronze: metal("#9a6128", .38),
    darkBronze: metal("#5a3414", .45),
    gold: metal("#efbd55", .24),
    brightGold: metal("#f4c25e", .18),
    iron: metal("#5a5e66", .38),
    steel: metal("#a9b3bd", .3),
    blueEnamel: enamel("#1460b0"),
    greenEnamel: enamel("#1c9a36"),
    redEnamel: enamel("#c0120a"),
    seaGem: enamel("#08b4d6"),
    whiteEnamel: enamel("#f4efe2"),
    cloth: matte("#8c130c", .72),
    blueCloth: matte("#154f9e", .72),
    leather: matte("#5a2d12", .6),
    oak: matte("#7a4a22", .68),
    darkOak: matte("#4a2a12", .72),
    shadow: matte("#140c06", .9),
    stone: matte("#857a66", .88)
  };
};
export type CursorMaterials = ReturnType<typeof createCursorMaterials>;

/** Cursor pixels to scene units (y up). */
export const toScene = ([x, y]: Point): Point => [x, -y];

const shapeOf = (outline: readonly Point[]) => {
  const shape = new THREE.Shape();
  outline.forEach((point, index) => {
    const [x, y] = toScene(point);
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  return shape;
};

export interface SlabOptions {
  bevel?: number;
  depth?: number;
  segments?: number;
}

/** A bevelled metal plate of `outline` (cursor pixels): `face` on the front, `side` on the bevelled rim. */
export const slab = (
  outline: readonly Point[], face: THREE.Material, side: THREE.Material,
  { bevel = .55, depth = .8, segments = 3 }: SlabOptions = {}
) => new THREE.Mesh(new THREE.ExtrudeGeometry(shapeOf(outline), {
  bevelEnabled: true, bevelSegments: segments, bevelSize: bevel, bevelThickness: bevel, depth, steps: 1
}), [face, side]);

/**
 * A forged, faceted cap: one flat facet from each outline edge up to the `apex` ridge point, so the
 * plate catches the key light facet by facet like a hammered arrowhead.
 */
export const facetedCap = (outline: readonly Point[], apex: Point, height: number, material: THREE.Material) => {
  const [apexX, apexY] = toScene(apex);
  const positions: number[] = [];
  outline.forEach((point, index) => {
    const [ax, ay] = toScene(point);
    const [bx, by] = toScene(outline[(index + 1) % outline.length]!);
    positions.push(ax, ay, 0, bx, by, 0, apexX, apexY, height);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
};

/** Moves `object` to cursor pixel `point` at depth `z`; returns it for chaining. */
export const at = <T extends THREE.Object3D>(object: T, point: Point, z = 0) => {
  const [x, y] = toScene(point);
  object.position.set(x, y, z);
  return object;
};

/** Points of a circle-like outline (cursor pixels), counter-clockwise on screen. */
export const ring = (center: Point, radiusX: number, radiusY = radiusX, steps = 28): Point[] =>
  Array.from({ length: steps }, (_, index) => {
    const angle = index / steps * Math.PI * 2;
    return [center[0] + Math.cos(angle) * radiusX, center[1] - Math.sin(angle) * radiusY] as const;
  });

/** A group whose children are authored in cursor pixels and which tilts around `pivot` towards the light. */
export const tiltedGroup = (pivot: Point, tiltX: number, tiltY: number) => {
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  at(outer, pivot);
  const [x, y] = toScene(pivot);
  inner.position.set(-x, -y, 0);
  outer.rotation.set(tiltX, tiltY, 0);
  outer.add(inner);
  return { add: (...objects: THREE.Object3D[]) => { inner.add(...objects); return outer; }, root: outer };
};

/** Name of the empty object that marks a model's hotspot; the renderer projects it to cursor pixels. */
export const HOTSPOT_MARKER = "cursor-hotspot";

export const hotspotMarker = (point: Point, z: number) => {
  const marker = at(new THREE.Object3D(), point, z);
  marker.name = HOTSPOT_MARKER;
  return marker;
};

/** Cursor pixel `distance` along the unit direction `direction` from `origin`, offset `across` to its left. */
export const along = (origin: Point, direction: Point, distance: number, across = 0): Point => [
  origin[0] + direction[0] * distance + direction[1] * across,
  origin[1] + direction[1] * distance - direction[0] * across
];

/** A round bar (cylinder) from `from` to `to` in cursor pixels, at depth `z`. */
export const bar = (
  from: Point, to: Point, radius: number, material: THREE.Material, z: number, tipRadius = radius
) => {
  const [ax, ay] = toScene(from);
  const [bx, by] = toScene(to);
  const length = Math.hypot(bx - ax, by - ay);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(tipRadius, radius, length, 18), material);
  mesh.position.set((ax + bx) / 2, (ay + by) / 2, z);
  mesh.rotation.z = Math.atan2(by - ay, bx - ax) - Math.PI / 2;
  return mesh;
};

/** A ball (pommel, rivet, finial) at a cursor pixel. */
export const ball = (center: Point, radius: number, material: THREE.Material, z: number) =>
  at(new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), material), center, z);
