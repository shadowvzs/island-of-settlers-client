import {
  BufferGeometry, Color, DataTexture, Float32BufferAttribute, Group, LatheGeometry,   LinearFilter, Mesh,
  MeshStandardMaterial, RepeatWrapping, RGBAFormat, SRGBColorSpace,
TorusGeometry, Vector2
} from "three";

import { disposeMeshGeometries } from "../three-mesh-resources";

/** Icon-only hot refractory vessel. Carried and stock crucibles retain their ordinary tool model. */
export const createHotCrucibleIconModel = () => {
  const root = new Group(); root.name = "hot_crucible_icon";
  const surfaces: MeshStandardMaterial[] = [];
  // A native ceramic/soot map also masks emission: char stays dark rather than glowing uniformly.
  const textureSize = 256;
  const pixels = new Uint8Array(textureSize * textureSize * 4);
  for (let y = 0; y < textureSize; y++) for (let x = 0; x < textureSize; x++) {
    const u = x / textureSize * Math.PI * 2, v = y / (textureSize - 1);
    const patch = .6 * Math.sin(u * 17 + Math.sin(v * 34) * .9) * Math.cos(v * 53 - u * 6) +
      .3 * Math.sin(u * 41 + v * 79) + .15 * Math.cos(u * 71 - v * 133);
    const rim = v > .48 && v < .78;
    const char = Math.max(0, Math.min(1, (patch - (rim ? .22 : .38)) / .42));
    const smoothChar = char * char * (3 - 2 * char);
    const grain = .94 + .06 * Math.sin(u * 127 + v * 173);
    const value = Math.round(grain * (1 - smoothChar * .78) * 255);
    const offset = (y * textureSize + x) * 4;
    pixels.set([value, value, value, 255], offset);
  }
  const ceramicMap = new DataTexture(pixels, textureSize, textureSize, RGBAFormat);
  ceramicMap.magFilter = ceramicMap.minFilter = LinearFilter;
  ceramicMap.colorSpace = SRGBColorSpace; ceramicMap.wrapS = RepeatWrapping; ceramicMap.needsUpdate = true;
  const ceramic = new MeshStandardMaterial({ vertexColors: true, roughness: .93,
    map: ceramicMap, emissiveMap: ceramicMap, emissive: "#ff3b02", emissiveIntensity: 1.05 });
  const molten = new MeshStandardMaterial({ vertexColors: true, roughness: .28, metalness: .18,
    emissive: "#fff3cb", emissiveIntensity: 1.65 });
  const edge = new MeshStandardMaterial({ color: "#ffc24a", roughness: .38,
    emissive: "#ff790b", emissiveIntensity: .9 });
  surfaces.push(ceramic, molten, edge);
  const add = (geometry: BufferGeometry, material: MeshStandardMaterial, name: string) => {
    const mesh = new Mesh(geometry, material); mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); return mesh;
  };
  // Closed thick shell, open above: outer base, rounded shoulder/rim, inner wall and bowl floor.
  const profile = [[0, .025], [.17, .025], [.205, .055], [.23, .14], [.275, .35],
    [.305, .49], [.30, .515], [.27, .525], [.25, .50], [.225, .35], [.17, .125], [0, .125]];
  const shell = new LatheGeometry(profile.map(([radius, y]) => new Vector2(radius!, y!)), 48);
  const points = shell.getAttribute("position"), normals = shell.getAttribute("normal"), colors: number[] = [];
  const cold = new Color("#861d08"), warm = new Color("#ff5106"), hot = new Color("#ff8a13");
  for (let index = 0; index < points.count; index++) {
    const x = points.getX(index), y = points.getY(index), z = points.getZ(index);
    const radius = Math.hypot(x, z);
    // A compact pouring lip, integrated through both sides of the shell rather than a solid handle.
    const lip = Math.pow(Math.max(0, z / Math.max(.001, radius)), 18) *
      Math.max(0, (y - .35) / .175);
    points.setXYZ(index, x * (1 + lip * .10), y + lip * .012, z + lip * .075);
    const heat = Math.max(0, Math.min(1, (y - .035) / .49));
    const inside = normals.getX(index) * x + normals.getZ(index) * z < 0;
    const color = cold.clone().lerp(warm, Math.pow(heat, .8));
    if (inside) color.lerp(hot, .35 + heat * .25);
    const grain = .96 + .04 * Math.sin(x * 211 + y * 153) * Math.cos(z * 187 - y * 69);
    color.multiplyScalar(grain); colors.push(color.r, color.g, color.b);
  }
  shell.setAttribute("color", new Float32BufferAttribute(colors, 3)); shell.computeVertexNormals();
  add(shell, ceramic, "thick_refractory_cup_with_pour_lip");
  // A shallow convex meniscus remains visibly recessed below the rim at the icon's elevated view.
  const liquid = new BufferGeometry(), positions: number[] = [0, .412, 0], liquidColors: number[] = [];
  const centre = new Color("#fffef1"), outer = new Color("#ffe28b"), indices: number[] = [];
  liquidColors.push(centre.r, centre.g, centre.b);
  for (let segment = 0; segment <= 48; segment++) {
    const angle = segment / 48 * Math.PI * 2;
    positions.push(Math.sin(angle) * .235, .402, Math.cos(angle) * .235);
    const color = outer.clone().lerp(centre, .15 + .08 * Math.sin(angle * 3));
    liquidColors.push(color.r, color.g, color.b);
    if (segment < 48) indices.push(0, segment + 1, segment + 2);
  }
  liquid.setAttribute("position", new Float32BufferAttribute(positions, 3));
  liquid.setAttribute("color", new Float32BufferAttribute(liquidColors, 3));
  liquid.setIndex(indices); liquid.computeVertexNormals();
  add(liquid, molten, "incandescent_molten_surface");
  const meniscus = add(new TorusGeometry(.231, .006, 6, 48), edge, "hot_meniscus");
  meniscus.rotation.x = Math.PI / 2; meniscus.position.y = .402;
  root.rotation.y = -.35;
  return { root, recipe: { framingMargin: 1.07, tightFraming: true, tool: false }, triangles: () => {
    let count = 0;
    root.traverse(object => { if (object instanceof Mesh)
      count += (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3; });
    return count;
  }, dispose: () => {
    disposeMeshGeometries(root);
    surfaces.forEach(material => material.dispose()); ceramicMap.dispose(); root.removeFromParent();
  } };
};
