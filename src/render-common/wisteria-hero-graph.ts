import { CatmullRomCurve3, Vector3 } from "three";

import { createClimberPendantComposition, sampleClimberShoot } from "./road-climber-composition";
import type { WisteriaRoadFrame } from "./road-decoration-wisteria";

export type WisteriaWoodPoint = readonly [number, number, number];
export interface WisteriaFlowerInstance {
  position: readonly [number, number, number]; yaw: number; scale: number; bud?: boolean;
  tilt?: number; cluster?: number; clusterOrigin?: readonly [number, number, number];
}
export interface WisteriaLeafInstance {
  position: readonly [number, number, number]; direction: readonly [number, number, number];
  length: number; shade: number; roll?: number; spray?: number; sprayOrigin?: readonly [number, number, number];
}
export interface WisteriaHeroLimb {
  points: WisteriaWoodPoint[];
  base: number;
  tip: number;
  settings: { fine?: boolean; grounded?: boolean; keepCurve?: boolean; retainMinimal?: boolean };
}

export const wisteriaHeroCrown = (frame: WisteriaRoadFrame, x: number) =>
  frame === "curved" ? 3.25 - .4 * (Math.abs(x) / 1.11) ** 3 : 3.12;

/** CPU-only canonical botanical layout: geometry and physical clearance use the same bearings. */
export const createWisteriaHeroGraph = (frameKind: WisteriaRoadFrame) => {
  const crownHeight = (x: number) => wisteriaHeroCrown(frameKind, x);
  const sideSprays: { position: [number, number, number]; side: number }[] = [];
  let mainStems = 0;
  const limbs: WisteriaHeroLimb[] = [];
  const limb = (points: WisteriaWoodPoint[], base: number, tip: number,
    settings: WisteriaHeroLimb["settings"] = {}) => {
    limbs.push({ points, base, tip, settings });
  };
  for (const side of [-1, 1]) {
    for (let spur = 0; spur < 4; spur++) {
      const angle = spur * 1.5, foot: WisteriaWoodPoint = [side + Math.cos(angle) * .10, .002, Math.sin(angle) * .13];
      limb([foot, [side + Math.cos(angle) * .04, .12, .05], [side, .26, .10]], .024, .046, { grounded: true });
    }
    for (let braid = 0; braid < 3; braid++) {
      const path: WisteriaWoodPoint[] = [[side, .12, .10]];
      for (let node = 1; node <= 12; node++) {
        const t = node / 12, angle = t * Math.PI * 3.5 + Math.sin(t * 11 + side) * .27 + braid * Math.PI * 2 / 3;
        path.push([side + Math.sin(angle) * (.085 + Math.sin(t * 8) * .018),
          .12 + t * (crownHeight(side) - .12), Math.cos(angle) * (.105 + Math.cos(t * 13) * .018)]);
      }
      path.push([side * .92, crownHeight(.92) + .08, braid ? .28 : -.28]);
      limb(path, [.043, .030, .022][braid]!, [.022, .018, .014][braid]!, { keepCurve: true }); mainStems++;
      for (const fork of [7, 10]) {
        const from = path[fork]!, z = [.20, -.20, .30][braid]!;
        const end: [number, number, number] = [side * 1.055, from[1] + .20 + braid * .07, z];
        limb([from, [side * 1.025, from[1] + .10, z * .6], end], .009, .003);
        sideSprays.push({ position: end, side });
      }
    }
  }
  const canes = new Map<number, WisteriaWoodPoint[]>();
  for (const z of [-.28, .28]) {
    const path = Array.from({ length: 13 }, (_, node): WisteriaWoodPoint => {
      const x = -1 + node / 12 * 2;
      return [x, crownHeight(x) + .11 + Math.sin(node * .8) * .015, z + Math.sin(node) * .025];
    });
    limb(path, .042, .026, { keepCurve: true });
    const curve = new CatmullRomCurve3(path.map(point => new Vector3(...point)));
    canes.set(Math.sign(z), Array.from({ length: 13 }, (_, index) => curve.getPointAt(index / 12).toArray()));
  }
  const seed = { curved: 47, lattice: 193, pergola: 619 }[frameKind];
  const composition = createClimberPendantComposition(28, seed,
    (at, side) => sampleClimberShoot(canes.get(side)!, at));
  for (const shoot of composition.shoots)
    for (let segment = 1; segment < shoot.points.length; segment++)
      limb([shoot.points[segment - 1]!, shoot.points[segment]!], .011 - segment * .002, .007 - segment * .0015);
  const flowers: WisteriaFlowerInstance[] = [], leaves: WisteriaLeafInstance[] = [];
  const inspection: { raceme: [number, number, number]; leaf: [number, number, number] } = {
    raceme: [0, 3, 0], leaf: [0, 3.3, 0]
  };
  const racemes = composition.sites.length;
  for (const site of composition.sites) {
    const [x, top, z] = site.attachment, length = site.length;
    const clusterOrigin = [x, top - site.neck - .004, z] as const;
    if (site.id === 4) inspection.raceme = [x, clusterOrigin[1] - length * .6, z];
    limb([site.attachment, clusterOrigin], .0018, .0012, { fine: true, retainMinimal: true });
    limb([clusterOrigin, [x + site.drift[0] * .45, clusterOrigin[1] - length * .5, z + site.drift[1] * .45],
      [x + site.drift[0], clusterOrigin[1] - length, z + site.drift[1]]], .0018, .0006, { fine: true });
    for (let bloom = 0; bloom < 25; bloom++) {
      const t = bloom / 24, angle = bloom * 2.39996 + site.yaw;
      const radius = .010 * (1 - t) ** .6 + .003, y = clusterOrigin[1] - t * length;
      const axis = [x + site.drift[0] * t, y, z + site.drift[1] * t] as const;
      const stem: WisteriaWoodPoint = [axis[0] + Math.sin(angle) * radius, y,
        axis[2] + Math.cos(angle) * radius];
      limb([axis, stem], .00065, .00035, { fine: true });
      flowers.push({ cluster: site.id, clusterOrigin, position: stem, yaw: angle, scale: .065 * (1 - .36 * t),
        bud: bloom >= 20, tilt: bloom >= 20 ? .1 : .65 + .35 * Math.sin(bloom * 1.3) ** 2 + site.tilt });
    }
  }
  const forward = new Vector3(), across = new Vector3();
  // Retain leafy cover between pendant groups: some axils grow on the connected main canes,
  // while others belong to the lateral flowering shoots. Same 42 crown sprays, no added density cost.
  const caneSprays = [...canes.values()].flatMap(points => Array.from({ length: 7 }, (_, index) => ({
    position: [...sampleClimberShoot(points, (index + .45) / 7 + Math.sin(index * 2.4) * .018)] as
      [number, number, number], side: 0
  })));
  const shootSprays = composition.shoots.flatMap(shoot => Array.from({ length: 4 }, (_, index) => ({
    position: [...sampleClimberShoot(shoot.points, .09 + index * .27)] as [number, number, number], side: 0
  })));
  const sprays = caneSprays.concat(shootSprays, sideSprays);
  for (const [sprig, spray] of sprays.entries()) {
    const [x, y, z] = spray.position, yaw = sprig * 2.39996;
    const postDirection = sprig % 2 ? -1 : 1;
    if (sprig === 5) inspection.leaf = [x, y, z];
    forward.set(spray.side ? spray.side * .1 : Math.sin(yaw), -.28 - sprig % 3 * .15,
      spray.side ? postDirection : Math.cos(yaw)).normalize();
    across.set(forward.z, 0, -forward.x).normalize();
    const length = spray.side ? .20 : .29 + sprig % 3 * .025;
    const at = (t: number): [number, number, number] => [x + forward.x * length * t,
      y + forward.y * length * t + Math.sin(Math.PI * t) * .035, z + forward.z * length * t];
    limb([at(0), at(.5), at(1)], .0022, .00065, { fine: true });
    for (let pair = 0; pair < 6; pair++) for (const side of [-1, 1]) {
      const t = .10 + pair * .145, centre = at(t), stem: [number, number, number] = [
        centre[0] + across.x * side * .007, centre[1], centre[2] + across.z * side * .007];
      limb([centre, stem], .0006, .0004, { fine: true });
      leaves.push({ spray: sprig, sprayOrigin: spray.position, position: stem, direction: [across.x * side + forward.x * .32, -.20,
        across.z * side + forward.z * .32], length: .082 + Math.sin(t * Math.PI) * .036,
      shade: .89 + sprig % 5 * .03,
      roll: ((sprig + pair) % 2 ? -1 : 1) * (.58 + ((sprig + pair) % 4) * .16) });
    }
    leaves.push({ spray: sprig, sprayOrigin: spray.position, position: at(1), direction: [forward.x, -.15, forward.z], length: .105, shade: .98 });
  }
  return { limbs, flowers, leaves, composition, inspection,
    counts: { flowers: flowers.filter(flower => !flower.bud).length,
      buds: flowers.filter(flower => flower.bud).length, leaflets: leaves.length, racemes, mainStems } };
};
