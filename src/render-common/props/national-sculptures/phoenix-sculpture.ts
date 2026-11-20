import { addPhoenixBreast, addPhoenixFeet, addPhoenixHead, addPhoenixNeckPlumage } from "./phoenix-sculpture-detail";
import { anatomySurface, type SculptureAnatomy } from "./sculpture-anatomy";
import { finishSculptureTier, sculptureSampling, type SculptureTier } from "./sculpture-quality";
import {
  carvedSculptureFeather, curveThrough, organicAnatomy, profileTube,   type SculpturePoint, type SculptureRecipe,
sculptureRecipeBuilder,
} from "./sculpture-recipe";

/** Original fiery raptor: continuous S-neck/breast, raised articulated wings and a flowing forked tail. */
export const createPhoenixSculptureRecipe = (detailed: boolean, tier: SculptureTier = "hero"): SculptureRecipe => {
  const { add, parts } = sculptureRecipeBuilder();
  const sampling = sculptureSampling(detailed, tier), fine = sampling.fine;
  const body: SculptureAnatomy = { kind: "anatomy", resolution: sampling.phoenix, blend: .037,
    bounds: { min: [-.25, .025, -.20], max: [.25, .94, .38] }, lobes: [
      { position: [0, .365, .018], radii: [.145, .215, .121], pitch: -.1 },
      { position: [0, .222, -.025], radii: [.112, .135, .105], pitch: -.08 },
      { position: [0, .492, .045], radii: [.106, .128, .088], pitch: -.18 },
      { position: [0, .608, .083], radii: [.078, .13, .073], pitch: -.25 },
      { position: [0, .705, .14], radii: [.062, .088, .069], pitch: -.22 },
      { position: [0, .769, .184], radii: [.073, .056, .094], pitch: -.18 },
      { position: [0, .794, .224], radii: [.061, .033, .059], pitch: -.2 },
      { position: [0, .738, .238], radii: [.045, .024, .046] },
    ] };
  add("phoenix_connected_anatomy", "phoenixCopper", organicAnatomy(body));
  const wings: SculptureAnatomy = { kind: "anatomy", resolution: sampling.wings, blend: .034,
    bounds: { min: [-.94, .31, -.23], max: [.94, 1.04, .20] }, lobes: [-1, 1].flatMap(side => [
      { position: [side * .166, .508, .015] as SculpturePoint, radii: [.168, .074, .078] as SculpturePoint, roll: side * .35 },
      { position: [side * .369, .601, .015] as SculpturePoint, radii: [.203, .062, .057] as SculpturePoint, roll: side * .48 },
      { position: [side * .591, .751, .015] as SculpturePoint, radii: [.176, .043, .055] as SculpturePoint, roll: side * .71 },
    ]) };
  if (fine) add("phoenix_connected_wing_bones", "phoenixCopper", organicAnatomy(wings));
  else for (const side of [-1, 1]) {
    // At display scale the thin implicit wing can fall between voxels. Follow the exact same
    // anatomical controls with a continuous tapered mesh rather than leave detached feathers.
    const controls: SculpturePoint[] = [[side * .075, .48, .015],
      ...wings.lobes.filter(lobe => lobe.position[0] * side > 0).map(lobe => lobe.position),
      [side * .72, .88, .015]];
    add("phoenix_display_wing_bone", "phoenixCopper", profileTube(curveThrough(controls),
      t => .071 * (1 - t) + .025, 10, 6));
  }
  addPhoenixBreast(add, fine, body);
  addPhoenixHead(add, fine);
  addPhoenixNeckPlumage(add, fine, body);
  addPhoenixFeet(add, fine);
  for (const side of [-1, 1]) {
    const primaries = fine ? 11 : 6;
    for (let index = 0; index < primaries; index++) {
      const t = index / (primaries - 1);
      const points: SculpturePoint[] = [[side * (.64 - t * .17), .78 - t * .18, 0],
        [side * (.89 - t * .035), .94 - t * .38, -.075],
        [side * (1.14 - t * .12), 1.09 - t * .68, -.12 - t * .035]];
      add("phoenix_primary_feather", "phoenixCopper", carvedSculptureFeather(points, .037 + t * .007, fine));
    }
    const secondaries = fine ? 8 : 4;
    for (let index = 0; index < secondaries; index++) {
      const t = index / (secondaries - 1);
      add("phoenix_secondary_feather", "phoenixCopper", carvedSculptureFeather(
        [[side * (.16 + t * .37), .49 + t * .16, 0],
          [side * (.31 + t * .37), .41 + t * .16, -.015],
          [side * (.39 + t * .43), .29 + t * .15, -.045]], .033, fine));
    }
    const coverts = fine ? 10 : 4;
    for (let row = 0; row < (fine ? 2 : 1); row++) for (let index = 0; index < coverts; index++) {
      const t = index / (coverts - 1), x = .14 + t * .53, y = .51 + t * .26 - row * .035;
      const points = [[side * x, y + .04], [side * (x + .065), y + .018],
        [side * (x + .13), y - .055]].map(([px, py], index) => [px!, py!,
        anatomySurface(wings, [px!, py!, 0], 2) + (index === 0 ? -.003 : .005)] as SculpturePoint);
      add("phoenix_layered_covert", "phoenixCopper", carvedSculptureFeather(points, .021, fine, true));
    }
    for (let index = 0; index < (fine ? 5 : 3); index++) {
      const t = index / (fine ? 4 : 2);
      const points: SculpturePoint[] = [[side * (.027 + t * .014), .22 - t * .025, -.06],
        [side * (.04 + t * .045), -.04, -.095], [side * (.10 + t * .09), -.32, -.12],
        [side * (.23 + t * .12), -.61 - t * .09, .005],
        [side * (.35 + t * .14), -.72 + Math.sin(t * 5) * .055, .145 + Math.sin(t * Math.PI) * .07]];
      add("phoenix_flowing_tail", "phoenixCopper", carvedSculptureFeather(points, .019 + t * .007, fine));
    }
  }
  return finishSculptureTier({ kind: "phoenix", detailed, parts, mountOrigin: [0, 0, 0],
    bounds: { min: [-1.145, -.78, -.16], max: [1.145, 1.10, .36] } }, tier);
};
