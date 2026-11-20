import { addQilinHeadDetail, addQilinHooves, addQilinMane, addQilinScales } from "./qilin-sculpture-detail";
import { anatomySurface, type SculptureAnatomy } from "./sculpture-anatomy";
import { finishSculptureTier, sculptureSampling, type SculptureTier } from "./sculpture-quality";
import {
  carvedSculptureFeather, curveThrough, organicAnatomy, profileTube,   type SculpturePoint, type SculptureRecipe,
sculptureRecipeBuilder,
} from "./sculpture-recipe";

/** Original jade dragon/deer guardian, with a fused chest/neck/head and articulated cloven stance. */
export const createQilinSculptureRecipe = (detailed: boolean, tier: SculptureTier = "hero"): SculptureRecipe => {
  const { add, parts } = sculptureRecipeBuilder();
  const sampling = sculptureSampling(detailed, tier), fine = sampling.fine;
  const body: SculptureAnatomy = { kind: "anatomy", blend: .047, resolution: sampling.qilin,
    bounds: { min: [-.27, .22, -.47], max: [.27, 1.105, .79] }, lobes: [
      { position: [0, .555, -.045], radii: [.153, .169, .335] },
      { position: [0, .565, .208], radii: [.155, .196, .163], pitch: -.22 },
      { position: [0, .574, -.29], radii: [.151, .171, .155] },
      { position: [0, .699, .248], radii: [.123, .153, .126], pitch: -.36 },
      { position: [0, .823, .316], radii: [.106, .161, .102], pitch: -.38 },
      { position: [0, .918, .393], radii: [.086, .117, .105], pitch: -.34 },
      { position: [0, .97, .462], radii: [.085, .090, .132], pitch: -.18 },
      { position: [0, .968, .553], radii: [.055, .038, .103], pitch: .24 },
      { position: [0, .928, .618], radii: [.052, .044, .104], pitch: .10 },
      { position: [0, .918, .701], radii: [.046, .029, .043], pitch: .08 },
      { position: [-.027, .918, .699], radii: [.022, .027, .041] },
      { position: [.027, .918, .699], radii: [.022, .027, .041] },
      { position: [-.058, .928, .476], radii: [.048, .056, .085] },
      { position: [.058, .928, .476], radii: [.048, .056, .085] },
      { position: [0, .889, .626], radii: [.049, .020, .090] },
      { position: [-.103, .475, .21], radii: [.064, .14, .072], pitch: -.13 },
      { position: [.103, .475, .21], radii: [.064, .14, .072], pitch: -.13 },
      { position: [-.1, .481, -.269], radii: [.077, .142, .105], pitch: -.4 },
      { position: [.1, .481, -.269], radii: [.077, .142, .105], pitch: -.4 },
    ] };
  add("qilin_connected_anatomy", "jade", organicAnatomy(body));
  for (const side of [-1, 1]) for (const front of [false, true]) {
    const points: SculpturePoint[] = front ? [[side * .112, .49, .218], [side * .128, .325, .224],
      [side * .12, .145, .255], [side * .12, .056, .285]] :
      [[side * .109, .48, -.265], [side * .14, .344, -.17],
        [side * .121, .178, -.301], [side * .12, .056, -.265]];
    const radii = front ? [.046, .031, .019, .025] : [.061, .035, .021, .025];
    add("qilin_articulated_leg", "jade", profileTube(curveThrough(points), t => {
      const position = Math.min(2.999, t * 3), index = Math.floor(position), blend = position - index;
      return radii[index]! * (1 - blend) + radii[index + 1]! * blend;
    }, fine ? 22 : 6, fine ? 12 : 6));
  }
  addQilinHooves(add, fine);
  addQilinHeadDetail(add, fine, body);
  addQilinMane(add, fine);
  addQilinScales(add, fine, body);
  // Throat scutes link the dragon muzzle to the scaled body, rather than a bare horse-like neck.
  for (let row = 0; row < (fine ? 7 : 3); row++) for (const column of fine ? [-1, 0, 1] : [0]) {
    const y = .56 + row * (fine ? .047 : .12), x = column * .036;
    const points = [y + .025, y, y - .037].map((height, index) => [x, height,
      anatomySurface(body, [x, height, 0], 2) + (index === 0 ? -.003 : .006)] as SculpturePoint);
    add("qilin_throat_scale", "jade", carvedSculptureFeather(points, fine ? .023 : .035, fine, true));
  }
  const tail: SculpturePoint[] = [[0, .627, -.372], [0, .735, -.47],
    [.071, .855, -.5], [.158, .908, -.436]];
  add("qilin_curved_tail", "jade", profileTube(curveThrough(tail), t => .031 * (1 - t) + .009,
    fine ? 24 : 7, fine ? 12 : 5));
  for (let lock = 0; lock < (fine ? 7 : 3); lock++) {
    const t = lock / (fine ? 6 : 2);
    add("qilin_tail_tassel", "gold", carvedSculptureFeather([[.093, .871, -.483],
      [.17 + t * .04, .95 + Math.sin(t * Math.PI) * .05, -.47],
      [.242 + t * .025, .925 - t * .065, -.39]], .016, fine));
  }
  return finishSculptureTier({ kind: "qilin", detailed, parts, mountOrigin: [0, 0, 0],
    bounds: { min: [-.23, 0, -.525], max: [.27, 1.26, .76] } }, tier);
};
