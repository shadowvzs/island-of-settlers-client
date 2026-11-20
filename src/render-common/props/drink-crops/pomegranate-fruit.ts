import { srgbToLinear } from "../../color";
import { MeshBuilder, normalize, type Vec3 } from "../mesh-builder";
import { addLathe, solid } from "./crop-mesh-parts";

/** One leathery fruit, including its sunken blossom end and six persistent calyx lobes. */
export const addPomegranateFruit = (builder: MeshBuilder, centre: Vec3, diameter: number,
  detailed: boolean, ripe = true, seed = 0) => {
  const radius = diameter / 2;
  const rings = detailed ? 8 : 4, segments = detailed ? 16 : 8;
  const first = builder.vertexCount;
  for (let ring = 0; ring <= rings; ring++) {
    const t = ring / rings, latitude = t * Math.PI;
    const width = Math.sin(latitude) * (1 + .035 * Math.cos(latitude * 2));
    for (let segment = 0; segment <= segments; segment++) {
      const angle = segment / segments * Math.PI * 2;
      const ribs = 1 + .012 * Math.cos(angle * 6);
      const x = Math.cos(angle) * width * ribs, z = Math.sin(angle) * width * ribs;
      const y = -Math.cos(latitude) * .94;
      const blush = .5 + .5 * Math.sin(angle * 2 + seed + t * 3);
      const freckle = Math.sin(angle * 39 + ring * 13 + seed) * .018;
      const color = ripe ? srgbToLinear(.59 + blush * .2 + freckle,
        .12 + (1 - blush) * .13 + freckle, .075 + (1 - blush) * .06)
        : srgbToLinear(.48 + blush * .1, .49 - blush * .12, .18);
      builder.addVertex([centre[0] + x * radius, centre[1] + y * radius,
        centre[2] + z * radius], normalize([x, y, z]), solid(color));
    }
  }
  for (let ring = 0; ring < rings; ring++) for (let segment = 0; segment < segments; segment++) {
    const a = first + ring * (segments + 1) + segment, b = a + segments + 1;
    builder.addTriangle(a, b, a + 1);
    builder.addTriangle(a + 1, b, b + 1);
  }
  const crown: Vec3 = [centre[0], centre[1] + radius * .91, centre[2]];
  const brown = solid(srgbToLinear(.43, .16, .07));
  addLathe(builder, { centre: crown, segments: detailed ? 18 : 12,
    profile: [[radius * .15, 0], [radius * .18, radius * .17],
      [radius * .25, radius * .22], [radius * .17, radius * .22], [radius * .12, radius * .07]] }, brown);
  for (let lobe = 0; lobe < 6; lobe++) {
    const angle = lobe / 6 * Math.PI * 2;
    const point = (yaw: number, r: number, h: number): Vec3 =>
      [crown[0] + Math.cos(yaw) * radius * r, crown[1] + radius * h,
        crown[2] + Math.sin(yaw) * radius * r];
    const normal = normalize([Math.cos(angle), .3, Math.sin(angle)]);
    const a = builder.addVertex(point(angle - .3, .23, .18), normal, brown);
    const b = builder.addVertex(point(angle + .3, .23, .18), normal, brown);
    const c = builder.addVertex(point(angle, .32, .43), normal, brown);
    builder.addTriangle(a, c, b);
    builder.addTriangle(b, c, a);
  }
};

export const createPomegranateFruitMesh = (detailed: boolean) => {
  const builder = new MeshBuilder();
  addPomegranateFruit(builder, [0, -.035, 0], .94, detailed);
  return builder.finish({ flex: 0 });
};
