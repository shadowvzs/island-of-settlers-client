import { MeshStandardMaterial, Vector3 } from "three";
import { expect, it } from "vitest";

import { createClimberPendantComposition, sampleClimberShoot } from "../src/render-common/road-climber-composition";
import { createWisteriaHero } from "../src/renderers/three/wisteria-hero";

it("grows varied pendant groups from connected lateral shoots on both sides of every frame", () => {
  const support = (at: number, side: -1 | 1) => [at * 2 - 1, 3.2 - at * at * .2, side * .28] as const;
  for (const seed of [47, 193, 619]) {
    const model = createClimberPendantComposition(28, seed, support);
    expect(model).toEqual(createClimberPendantComposition(28, seed, support));
    const sizes = model.shoots.map(shoot => model.sites.filter(site => site.shoot === shoot.id).length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeGreaterThan(1);
    expect(model.shoots.filter(shoot => shoot.points[0]![2] > 0).length).toBeGreaterThanOrEqual(3);
    expect(model.shoots.filter(shoot => shoot.points[0]![2] < 0).length).toBeGreaterThanOrEqual(3);
    for (const site of model.sites) {
      const shoot = model.shoots[site.shoot]!;
      // Independent point-to-segment measurement catches unsupported jittered endpoints.
      const attachment = new Vector3(...site.attachment);
      const distances = shoot.points.slice(1).map((to, index) => {
        const from = new Vector3(...shoot.points[index]!), axis = new Vector3(...to).sub(from);
        const along = Math.max(0, Math.min(1, attachment.clone().sub(from).dot(axis) / axis.lengthSq()));
        return from.addScaledVector(axis, along).distanceTo(attachment);
      });
      expect(Math.min(...distances)).toBeLessThan(1e-10);
      expect(site.attachment).toEqual(sampleClimberShoot(shoot.points, site.at));
    }
    const lengths = model.sites.map(site => site.length), heights = model.sites.map(site => site.attachment[1]);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeGreaterThan(.2);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(.1);
    const positions = model.sites.map(site => site.attachment[0]).sort((a, b) => a - b);
    const gaps = positions.slice(1).map((x, index) => x - positions[index]!);
    expect(Math.max(...gaps)).toBeGreaterThan(Math.min(...gaps) * 5);
    expect(new Set(model.sites.map(site => site.yaw.toFixed(2))).size).toBeGreaterThan(20);
  }
});

it("all premium frame adapters keep six trunks and full botanical density with distinct connected compositions", () => {
  const wood = new MeshStandardMaterial(), signatures: string[] = [];
  try {
    for (const frame of ["curved", "lattice", "pergola"] as const) {
      const model = createWisteriaHero({ wood } as Parameters<typeof createWisteriaHero>[0], undefined, { frame });
      try {
        expect(model.counts).toEqual({ flowers: 560, buds: 140, leaflets: 702, racemes: 28, mainStems: 6 });
        for (const site of model.botany.composition.sites) {
          const first = model.botany.flowers.find(flower => flower.cluster === site.id)!;
          expect(first.clusterOrigin).toEqual([site.attachment[0], site.attachment[1] - site.neck - .004,
            site.attachment[2]]);
        }
        signatures.push(JSON.stringify(model.botany.composition.sites));
      } finally { model.dispose(); }
    }
    expect(new Set(signatures).size).toBe(3);
  } finally { wood.dispose(); }
});
