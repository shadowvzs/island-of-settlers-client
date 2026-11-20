import { srgbToLinear } from "../color";
import { CHINESE_LANTERN_GLYPHS } from "./chinese-lantern-glyphs";
import { CHINESE_LANTERN_PROFILE, lanternInkTriangles } from "./chinese-lantern-ink";
import { addLathe, solid } from "./drink-crops/crop-mesh-parts";
import { MeshBuilder, normalize, type Vec3 } from "./mesh-builder";
import { addCurvedTube } from "./tree-parts";

/** Original reusable red silk lantern: rooted at its tassel, suspension point exactly one unit up. */
export const createChineseLanternMesh = (detailed: boolean, inscription?: number) => {
  const builder = new MeshBuilder();
  const gold: Vec3 = srgbToLinear(.87, .59, .14), red: Vec3 = srgbToLinear(.8, .045, .025);
  const silk = { flutter: 0, color: (point: Vec3): Vec3 => {
    const around = Math.atan2(point[2], point[0]);
    const rib = Math.cos(around * 12);
    if (detailed && rib > .97) return srgbToLinear(.65, .29, .055);
    const shade = .9 + Math.cos(around * 12) * .075 + Math.sin(point[1] * 90) * .012;
    return [red[0] * shade, red[1] * shade, red[2] * shade];
  } };
  addLathe(builder, { centre: [0, 0, 0], segments: detailed ? 48 : 12,
    profile: CHINESE_LANTERN_PROFILE,
    ridges: { count: 12, depth: .02 } }, silk);
  for (const y of [.275, .825]) addLathe(builder, { centre: [0, y, 0],
    segments: detailed ? 24 : 8, profile: detailed ? [[0, 0], [.13, 0], [.14, .012],
      [.14, .031], [.115, .045], [0, .045]] : [[0, 0], [.14, .008], [.14, .036], [0, .045]] }, solid(gold));
  addCurvedTube(builder, [[0, .865, 0], [0, .93, 0], [0, 1, 0]], [.009, .007, .007],
    detailed ? 6 : 3, solid(srgbToLinear(.36, .2, .06)), [0, 0, 0]);
  addLathe(builder, { centre: [0, .215, 0], segments: detailed ? 12 : 6,
    profile: [[0, 0], [.032, .008], [.041, .027], [.027, .055], [0, .065]] }, solid(gold));
  for (let strand = 0; strand < (detailed ? 9 : 4); strand++) {
    const yaw = strand * 2.39996, spread = .028 + strand % 3 * .009;
    addCurvedTube(builder, [[Math.sin(yaw) * .012, .22, Math.cos(yaw) * .012],
      [Math.sin(yaw) * spread, .12, Math.cos(yaw) * spread],
      [Math.sin(yaw) * spread * 1.25, .012 + strand % 3 * .008, Math.cos(yaw) * spread * 1.25]],
    [.006, .005, .003], detailed ? 4 : 3, solid(strand % 3 ? red : gold), [0, 0, 0]);
  }
  if (inscription !== undefined) addLanternInscription(builder, inscription, detailed);
  return builder.finish({ flex: 0 });
};

/** Font-derived gold lettering follows the silk's curved front rather than a floating flat placard. */
const addLanternInscription = (builder: MeshBuilder, inscription: number, detailed: boolean) => {
  const glyph = CHINESE_LANTERN_GLYPHS[inscription];
  if (!glyph) return;
  const style = solid(srgbToLinear(.98, .8, .32));
  for (const triangle of lanternInkTriangles(glyph, detailed)) {
    const start = builder.vertexCount;
    for (const point of triangle) builder.addVertex(point, normalize([point[0], 0, point[2]]), style);
    builder.addTriangle(start, start + 1, start + 2);
  }
};
