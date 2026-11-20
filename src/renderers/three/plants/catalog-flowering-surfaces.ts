import { BufferGeometry, Color, Float32BufferAttribute, Vector3 } from "three";

import {   createCatalogFloweringGraph,floweringMix, floweringNoise, type FloweringPoint, type FloweringSpecies } from "../../../render-common/plants/catalog-flowering-graph";
import { createOrnamentalShootGeometry } from "./ornamental-shoot-geometry";
import { createOrnamentalWoodGeometry } from "./ornamental-wood-geometry";

class Surface {
  positions: number[] = [];
  colors: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];
  vertex(point: Vector3, color: Color, u = 0, v = 0) {
    const index = this.positions.length / 3;
    this.positions.push(point.x, point.y, point.z); this.colors.push(color.r, color.g, color.b);
    this.uvs.push(u, v); return index;
  }
  append(geometry: BufferGeometry) {
    const offset = this.positions.length / 3, positions = geometry.getAttribute("position");
    const colors = geometry.getAttribute("color"), uvs = geometry.getAttribute("uv");
    for (let i = 0; i < positions.count; i++) {
      this.positions.push(positions.getX(i), positions.getY(i), positions.getZ(i));
      this.colors.push(colors.getX(i), colors.getY(i), colors.getZ(i));
      this.uvs.push(uvs.getX(i), uvs.getY(i));
    }
    if (geometry.index) for (let i = 0; i < geometry.index.count; i++)
      this.indices.push(offset + geometry.index.getX(i));
    geometry.dispose();
  }
  geometry() {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(this.uvs, 2));
    geometry.setIndex(this.indices); geometry.computeVertexNormals();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return geometry;
  }
}
const vec = (p: FloweringPoint) => new Vector3(...p);
const stem = (surface: Surface, points: FloweringPoint[], radius: number, tip: number, sides: number,
  color: Color) => {
  const offset = surface.positions.length / 3;
  for (let row = 0; row < points.length; row++) {
    const p = vec(points[row]!);
    const tangent = vec(points[Math.min(points.length - 1, row + 1)]!)
      .sub(vec(points[Math.max(0, row - 1)]!)).normalize();
    const x = new Vector3(0, 0, 1).cross(tangent).normalize();
    const z = tangent.clone().cross(x).normalize();
    const width = radius + (tip - radius) * row / (points.length - 1);
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * Math.PI * 2;
      const rib = 1 + .09 * Math.sin(angle * 3 + row * 1.3);
      const vertex = p.clone().addScaledVector(x, Math.cos(angle) * width * rib)
        .addScaledVector(z, Math.sin(angle) * width * rib);
      surface.vertex(vertex, color, side / sides, row * .4);
      if (!row || !side) continue;
      const b = offset + row * (sides + 1) + side;
      surface.indices.push(b - sides - 2, b - 1, b, b - sides - 2, b, b - sides - 1);
    }
  }
};
const flower = (surface: Surface, center: Vector3, size: number, cherry: boolean, double: boolean,
  seed: number, detailed: boolean, color: Color) => {
  const normal = new Vector3(Math.sin(seed) * .85, .20 + floweringNoise(seed) * 1.1, Math.cos(seed) * .85).normalize();
  const x = new Vector3(0, 0, 1).cross(normal).normalize(), z = normal.clone().cross(x);
  const point = (angle: number, reach: number, cup: number) => center.clone()
    .addScaledVector(x, Math.cos(angle) * reach * size).addScaledVector(z, Math.sin(angle) * reach * size)
    .addScaledVector(normal, cup * size);
  const layers = double ? 2 : 1;
  for (let layer = 0; layer < layers; layer++) for (let petal = 0; petal < 5; petal++) {
    const angle = petal * Math.PI * 2 / 5 + layer * .58 + seed;
    const scale = 1 - layer * .22;
    const dark = color.clone().multiplyScalar(.62 + layer * .07);
    const root = surface.vertex(point(angle, .04, .03 + layer * .13), dark, .5, 0);
    const left = surface.vertex(point(angle - .60, .70 * scale, .19 + layer * .15), color, 0, .65);
    const a = surface.vertex(point(angle - .32, scale, .29 + layer * .15), color, .18, 1);
    const tip = surface.vertex(point(angle, scale * (cherry ? .88 : 1.04), .25 + layer * .15), color, .5, 1);
    const b = surface.vertex(point(angle + .32, scale, .29 + layer * .15), color, .82, 1);
    const right = surface.vertex(point(angle + .60, .70 * scale, .19 + layer * .15), color, 1, .65);
    if (!detailed) {
      surface.indices.push(root, left, a, root, a, tip, root, tip, b, root, b, right);
      continue;
    }
    const middle = surface.vertex(point(angle, scale * .56, .075 + layer * .15),
      color.clone().multiplyScalar(.88), .5, .56);
    surface.indices.push(middle, root, left, middle, left, a, middle, a, tip,
      middle, tip, b, middle, b, right, middle, right, root);
  }
  // A small closed receptacle embeds the corolla bases and the filaments in the bearing pedicel.
  const receptacle = color.clone().multiplyScalar(.62);
  const bottom = surface.vertex(point(0, 0, -.05), receptacle);
  const ring = [0, 1, 2].map(index => surface.vertex(point(index * Math.PI * 2 / 3, .12, .10), receptacle));
  surface.indices.push(bottom, ring[1]!, ring[0]!, bottom, ring[2]!, ring[1]!,
    bottom, ring[0]!, ring[2]!, ring[0]!, ring[1]!, ring[2]!);
  // Five green sepals form a real calyx beneath the corolla, on the bearing pedicel.
  const green = new Color("#517537");
  for (let sepal = 0; sepal < 5; sepal++) {
    const angle = sepal * Math.PI * 2 / 5 + seed;
    const a = surface.vertex(center.clone(), green);
    const tip = surface.vertex(point(angle, .42, -.06), green);
    const b = surface.vertex(point(angle + .28, .17, -.025), green);
    surface.indices.push(a, tip, b);
  }
  const gold = new Color("#f3c64c"), filament = new Color("#ffe3a1");
  const heart = surface.vertex(center.clone(), filament);
  const count = detailed ? 6 : 3;
  for (let i = 0; i < count; i++) {
    const angle = i / count * Math.PI * 2;
    const a = surface.vertex(point(angle - .025, .20, .32), filament);
    const b = surface.vertex(point(angle + .025, .20, .32), filament);
    surface.indices.push(heart, a, b);
    const left = surface.vertex(point(angle - .12, .21, .34), gold);
    const tip = surface.vertex(point(angle, .25, .38), gold);
    const right = surface.vertex(point(angle + .12, .21, .34), gold);
    surface.indices.push(a, left, tip, b, tip, right);
  }
};
const leaf = (surface: Surface, start: Vector3, yaw: number, length: number, width: number,
  maple: boolean, seed: number, color: Color, detailed: boolean) => {
  const direction = new Vector3(Math.cos(yaw), .22 + Math.sin(seed) * .18, Math.sin(yaw)).normalize();
  const lateral = new Vector3(-Math.sin(yaw), .14, Math.cos(yaw)).normalize();
  if (maple) {
    const ridge = start.clone().addScaledVector(direction, length * .46); ridge.y += .012;
    const center = surface.vertex(ridge, color.clone().multiplyScalar(1.12), .5, .46);
    const outline = [[0, 0], [-.22, .23], [-.55, .18], [-.36, .46], [-.75, .62],
      [-.30, .65], [0, 1], [.30, .65], [.75, .62], [.36, .46], [.55, .18], [.22, .23]];
    const ring = outline.map(([x, y]) => surface.vertex(start.clone()
      .addScaledVector(direction, y! * length).addScaledVector(lateral, x! * length),
      color.clone().multiplyScalar(.80 + y! * .25), x! / 1.5 + .5, y!));
    for (let i = 0; i < ring.length; i++)
      surface.indices.push(center, ring[i]!, ring[(i + 1) % ring.length]!);
    return;
  }
  const index = surface.positions.length / 3;
  const rows = detailed ? 4 : 2;
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const middle = start.clone().addScaledVector(direction, length * t);
    middle.y += Math.sin(t * Math.PI) * .016;
    let spread = Math.sin(t * Math.PI) ** .72 * width;
    if (maple && row === 2) spread *= 1.42;
    for (let side = -1; side <= 1; side++) {
      const p = middle.clone().addScaledVector(lateral, spread * side);
      p.y -= Math.abs(side) * .018 * Math.sin(t * Math.PI);
      const shade = side === 0 ? 1.18 : .76 + floweringNoise(seed + row * 3 + side) * .22;
      surface.vertex(p, color.clone().multiplyScalar(shade), (side + 1) / 2, t);
    }
    if (!row) continue;
    const a = index + row * 3;
    surface.indices.push(a - 3, a, a - 2, a - 2, a, a + 1, a - 2, a + 1, a - 1, a - 1, a + 1, a + 2);
  }
};
export const createCatalogFloweringSurfaces = (species: FloweringSpecies, variant: number,
  roadside: boolean, detailed: boolean) => {
  const graph = createCatalogFloweringGraph(species, variant, roadside, detailed);
  const bark = new Surface(), foliage = new Surface(), blossoms = new Surface();
  const cherry = species.includes("cherry"), maple = species === "red-maple", double = species === "double-peach";
  const woodColor = new Color("#ffffff");
  for (const [index, limb] of graph.limbs.entries()) {
    const role = limb.role;
    const authored = { parent: null, path: limb.points, radius: limb.radius, tipRadius: limb.tip, role };
    if (role === "twig" || limb.radius < .018) { bark.append(createOrnamentalShootGeometry(authored)); continue; }
    let rings = detailed ? 10 : 4, sides = detailed ? 7 : 4;
    if (role === "root") { rings = detailed ? 4 : 2; sides = detailed ? 5 : 4; }
    if (role === "trunk") { rings = detailed ? 14 : 6; sides = detailed ? 9 : 5; }
    bark.append(createOrnamentalWoodGeometry(authored, detailed, index, { rings, sides }));
  }
  const leafColor = new Color(maple ? "#c84629" : "#78a743");
  let flowerColor = new Color("#ff91b0");
  if (species.startsWith("white")) flowerColor = new Color("#fff1d8");
  if (double) flowerColor = new Color("#f45186");
  for (const shoot of graph.shoots) {
    const flowerCount = 2;
    for (let i = 0; i < flowerCount; i++) {
      const position = vec(floweringMix(shoot.start, shoot.end, .30 + i / flowerCount * .68));
      const angle = shoot.seed + i * 2.399;
      if (detailed || i % 2 === 0) {
        const leafTip = position.clone().add(new Vector3(Math.cos(angle) * .025, .015, Math.sin(angle) * .025));
        stem(bark, [position.toArray() as FloweringPoint, leafTip.toArray() as FloweringPoint],
          .0035, .002, 3, woodColor);
        leaf(foliage, leafTip, angle, cherry ? .15 : .19, cherry ? .047 : .026,
          maple, shoot.seed + i, leafColor, detailed);
      }
      if (maple) continue;
      const bloom = position.clone().add(new Vector3(Math.cos(angle) * (cherry ? .042 : .013),
        cherry ? .046 : .018, Math.sin(angle) * (cherry ? .042 : .013)));
      stem(bark, [position.toArray() as FloweringPoint, bloom.toArray() as FloweringPoint],
        .0038, .003, 3, woodColor);
      flower(blossoms, bloom, roadside ? .085 : .12, cherry, double, shoot.seed + i * 7, detailed, flowerColor);
    }
  }
  const surfaces = { bark: bark.geometry(), blossoms: blossoms.geometry(), foliage: foliage.geometry() };
  const triangles = Object.values(surfaces).reduce((sum, geometry) => sum + (geometry.index?.count ?? 0) / 3, 0);
  return { ...surfaces, triangles };
};
