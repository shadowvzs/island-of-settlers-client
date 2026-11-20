import {
  BufferGeometry, CatmullRomCurve3, DataTexture, Float32BufferAttribute, Group,
  LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace,
  TubeGeometry, Vector2, Vector3
} from "three";

/** Original offline icon model: a gathered leather pouch with a real cord and tied bow. */
const PROFILE = [
  [-.56, .05], [-.53, .23], [-.44, .37], [-.29, .45], [-.10, .46],
  [.08, .40], [.24, .30], [.34, .21], [.42, .165], [.47, .18], [.56, .235], [.60, .255]
] as const;
const ringRadius = (height: number) => {
  const index = Math.min(Math.floor(height), PROFILE.length - 2);
  const blend = height - index;
  const a = PROFILE[index]!, b = PROFILE[index + 1]!;
  return { radius: a[1] + (b[1] - a[1]) * blend, y: a[0] + (b[0] - a[0]) * blend };
};
const leatherPoint = (height: number, angle: number, inset = 0) => {
  const { radius, y } = ringRadius(height);
  const gather = Math.max(0, (y - .05) / .55);
  const folds = .019 * Math.sin(angle * 9 + .4) * gather +
    .008 * Math.sin(angle * 13 - y * 6) * gather;
  const bulge = .012 * Math.cos(angle * 3 + y * 5) * (1 - gather);
  const r = radius + folds + bulge - inset;
  return new Vector3(Math.sin(angle) * r, y + .011 * Math.sin(angle * 9) * gather,
    Math.cos(angle) * r * .77);
};
const createLeatherGeometry = (inset = 0, inner = false) => {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  const segments = 96, rows = 56;
  const start = inner ? 7.8 : 0;
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    for (let segment = 0; segment <= segments; segment++) {
      const point = leatherPoint(start + t * (PROFILE.length - 1 - start), segment / segments * Math.PI * 2 + Math.PI, inset);
      positions.push(point.x, point.y, point.z); uv.push(segment / segments, t);
    }
  }
  for (let row = 0; row < rows; row++) for (let segment = 0; segment < segments; segment++) {
    const a = row * (segments + 1) + segment, b = a + segments + 1;
    if (inner) indices.push(a, b, a + 1, a + 1, b, b + 1);
    else indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  if (!inner) {
    const center = positions.length / 3;
    positions.push(0, PROFILE[0][0], 0); uv.push(.5, 0);
    for (let segment = 0; segment < segments; segment++) indices.push(center, segment + 1, segment);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
};
const grainValue = (x: number, y: number) => {
  const seed = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return seed - Math.floor(seed);
};
const leatherMaterials = () => {
  const size = 256, pixels = new Uint8Array(size * size * 4), normals = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = (y * size + x) * 4;
    const pore = grainValue(x, y), cloud = Math.sin(x * .031) * Math.sin(y * .049) * .025;
    const tone = .89 + pore * .18 + cloud;
    pixels.set([Math.round(172 * tone), Math.round(105 * tone), Math.round(52 * tone), 255], at);
    normals.set([128 + Math.round((pore - grainValue(x + 1, y)) * 17),
      128 + Math.round((pore - grainValue(x, y + 1)) * 17), 255, 255], at);
  }
  const map = new DataTexture(pixels, size, size), normalMap = new DataTexture(normals, size, size);
  for (const texture of [map, normalMap]) {
    texture.wrapS = texture.wrapT = RepeatWrapping; texture.repeat.set(3, 2);
    texture.generateMipmaps = true; texture.minFilter = LinearMipmapLinearFilter; texture.needsUpdate = true;
  }
  map.colorSpace = SRGBColorSpace;
  const outer = new MeshStandardMaterial({ color: "#c28a51", map, normalMap,
    normalScale: new Vector2(.3, .3), roughness: .76 });
  outer.addEventListener("dispose", () => normalMap.dispose());
  return { cord: new MeshStandardMaterial({ color: "#e7c68b", roughness: .88 }), outer,
    inner: new MeshStandardMaterial({ color: "#684023", roughness: .93 }) };
};
const addCord = (root: Group, name: string, points: Vector3[], radius: number,
  material: MeshStandardMaterial, closed = false) => {
  const curve = new CatmullRomCurve3(points, closed, "centripetal");
  const mesh = new Mesh(new TubeGeometry(curve, 96, radius, 8, closed), material);
  mesh.name = name; root.add(mesh);
  return curve;
};
const addPouchSeam = (root: Group, material: MeshStandardMaterial) => {
  for (const side of [-1, 1]) for (let stitch = 0; stitch < 30; stitch++) {
    const height = .7 + stitch * .21;
    const angle = side * 1.28;
    const a = leatherPoint(height, angle - .022, -.003);
    const b = leatherPoint(height + .065, angle + .022, -.003);
    const mesh = new Mesh(new TubeGeometry(new CatmullRomCurve3([a, b]), 2, .0045, 4), material);
    mesh.name = "pouch-stitched-seam"; root.add(mesh);
  }
};
export const createInventoryPouchIcon = () => {
  const root = new Group(), materials = leatherMaterials();
  root.name = "inventory-leather-pouch";
  const body = new Mesh(createLeatherGeometry(), materials.outer); body.name = "soft-leather-body"; root.add(body);
  const lining = new Mesh(createLeatherGeometry(.012, true), materials.inner);
  lining.name = "folded-inner-neck"; root.add(lining);
  const rim = Array.from({ length: 97 }, (_, i) => leatherPoint(11, i / 96 * Math.PI * 2, .005));
  addCord(root, "rolled-leather-lip", rim, .009, materials.outer, true);
  const wrap = Array.from({ length: 97 }, (_, i) => {
    const angle = i / 96 * Math.PI * 4;
    return new Vector3(Math.sin(angle) * .188, .395 + i / 96 * .045, Math.cos(angle) * .148);
  });
  addCord(root, "neck-double-drawstring-wrap", wrap, .014, materials.cord);
  const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
  addCord(root, "left-tied-loop", [v(-.02, .42, .173), v(-.16, .51, .205), v(-.24, .45, .22),
    v(-.19, .365, .23), v(-.015, .405, .20)], .016, materials.cord);
  addCord(root, "right-tied-loop", [v(.015, .405, .19), v(.15, .49, .21), v(.23, .43, .22),
    v(.16, .35, .24), v(-.015, .42, .21)], .016, materials.cord);
  addCord(root, "left-cord-tail", [v(-.015, .41, .20), v(-.06, .25, .25), v(-.12, .06, .34),
    v(-.10, -.03, .35)], .014, materials.cord);
  addCord(root, "right-cord-tail", [v(.015, .41, .21), v(.085, .25, .27), v(.14, .12, .31),
    v(.16, .08, .33)], .014, materials.cord);
  addCord(root, "cord-knot", [v(-.03, .395, .205), v(-.025, .44, .215), v(.02, .445, .22),
    v(.035, .41, .225), v(0, .395, .23)], .021, materials.cord);
  addPouchSeam(root, materials.cord);
  root.rotation.z = -.075;
  root.userData.inventoryIcon = { originalModel: true, leatherGrain: true, cordWraps: 2, tiedLoops: 2 };
  return root;
};
