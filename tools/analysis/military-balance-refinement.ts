import { writeFileSync } from "node:fs";

import {
  FINAL_CANDIDATE,
  type Profiles,
  type Rank,
  simulate,
  type UnitKind
} from "./military-balance-simulator";
const army = (kind: UnitKind, rank: Rank, count: number) =>
  Array.from({ length: count }, () => ({ kind, rank }));
const summarize = (
  left: ReturnType<typeof army>,
  right: ReturnType<typeof army>,
  profiles: Profiles,
  lanes: number
) => {
  const runs = Array.from({ length: 32 }, (_, seed) =>
    simulate(left, right, profiles, 1000 + seed, { lanes, archerAimError: true })
  );
  const wins = [0, 0];
  for (const run of runs) if (run.winner >= 0) wins[run.winner]!++;
  return {
    wins,
    draws: runs.filter((run) => run.winner < 0).length,
    leftWinShare: wins[0]! / 32,
    meanSeconds: runs.reduce((sum, r) => sum + r.seconds, 0) / 32,
    spent: runs[0]!.spent
  };
};
interface Variant {
  name: string;
  heavyHp: number;
  heavyDamage: number;
  heavyArmor: number[];
  heavySpeed: number;
  archerHp: number;
  archerDamage: number;
  cavHp?: number;
  cavDamage?: number;
  shieldHp?: number;
}
const variants: Variant[] = [
  {
    name: "aimPrevious",
    heavyHp: 100,
    heavyDamage: 16,
    heavyArmor: [0.1, 0.2, 0.3],
    heavySpeed: 1.8,
    archerHp: 75,
    archerDamage: 15
  },
  {
    name: "aimBow18hp85",
    heavyHp: 100,
    heavyDamage: 16,
    heavyArmor: [0.1, 0.2, 0.3],
    heavySpeed: 1.8,
    archerHp: 85,
    archerDamage: 18
  },
  {
    name: "aimBow20hp85",
    heavyHp: 100,
    heavyDamage: 16,
    heavyArmor: [0.1, 0.2, 0.3],
    heavySpeed: 1.8,
    archerHp: 85,
    archerDamage: 20
  },
  {
    name: "aimBow18hp90",
    heavyHp: 100,
    heavyDamage: 16,
    heavyArmor: [0.1, 0.2, 0.3],
    heavySpeed: 1.8,
    archerHp: 90,
    archerDamage: 18
  },
  {
    name: "aimBow20hp90",
    heavyHp: 100,
    heavyDamage: 16,
    heavyArmor: [0.1, 0.2, 0.3],
    heavySpeed: 1.8,
    archerHp: 90,
    archerDamage: 20
  },
  {
    name: "aimReducedArmor18",
    heavyHp: 100,
    heavyDamage: 16,
    heavyArmor: [0.1, 0.15, 0.2],
    heavySpeed: 1.8,
    archerHp: 90,
    archerDamage: 18
  },
  {
    name: "aimBow22hp85",
    heavyHp: 100,
    heavyDamage: 16,
    heavyArmor: [0.1, 0.2, 0.3],
    heavySpeed: 1.8,
    archerHp: 85,
    archerDamage: 22
  },
  {
    name: "aimFragileHeavy18",
    heavyHp: 85,
    heavyDamage: 19,
    heavyArmor: [0.1, 0.15, 0.2],
    heavySpeed: 1.8,
    archerHp: 85,
    archerDamage: 18
  },
  {
    name: "armor20heavy17cav105",
    heavyHp: 100,
    heavyDamage: 17,
    heavyArmor: [0.1, 0.15, 0.2],
    heavySpeed: 1.8,
    archerHp: 75,
    archerDamage: 15,
    cavHp: 105,
    cavDamage: 12
  },
  {
    name: "armor20heavy17cav110",
    heavyHp: 100,
    heavyDamage: 17,
    heavyArmor: [0.1, 0.15, 0.2],
    heavySpeed: 1.8,
    archerHp: 75,
    archerDamage: 15,
    cavHp: 110,
    cavDamage: 12
  },
  {
    name: "armor20heavy17cav125",
    heavyHp: 100,
    heavyDamage: 17,
    heavyArmor: [0.1, 0.15, 0.2],
    heavySpeed: 1.8,
    archerHp: 75,
    archerDamage: 15,
    cavHp: 110,
    cavDamage: 12.5,
    shieldHp: 125
  },
  {
    name: "armor20heavy165cav125",
    heavyHp: 100,
    heavyDamage: 16.5,
    heavyArmor: [0.1, 0.15, 0.2],
    heavySpeed: 1.8,
    archerHp: 75,
    archerDamage: 15,
    cavHp: 110,
    cavDamage: 12.5,
    shieldHp: 125
  },
  {
    name: "armor20heavy17cav13",
    heavyHp: 100,
    heavyDamage: 17,
    heavyArmor: [0.1, 0.15, 0.2],
    heavySpeed: 1.8,
    archerHp: 75,
    archerDamage: 15,
    cavHp: 105,
    cavDamage: 13,
    shieldHp: 125
  },
  {
    name: "armor20heavy165cav13",
    heavyHp: 100,
    heavyDamage: 16.5,
    heavyArmor: [0.1, 0.15, 0.2],
    heavySpeed: 1.8,
    archerHp: 75,
    archerDamage: 15,
    cavHp: 105,
    cavDamage: 13,
    shieldHp: 125
  },
  {
    name: "aimSlowHeavy100Bow18hp90",
    heavyHp: 100,
    heavyDamage: 16,
    heavyArmor: [0.1, 0.15, 0.2],
    heavySpeed: 1,
    archerHp: 90,
    archerDamage: 18
  },
  {
    name: "aimSlowHeavy100Bow18hp95",
    heavyHp: 100,
    heavyDamage: 16,
    heavyArmor: [0.1, 0.15, 0.2],
    heavySpeed: 1,
    archerHp: 95,
    archerDamage: 18
  },
  {
    name: "aimSlowHeavy110Bow20hp90",
    heavyHp: 100,
    heavyDamage: 16,
    heavyArmor: [0.1, 0.15, 0.2],
    heavySpeed: 1.1,
    archerHp: 90,
    archerDamage: 20
  },
  {
    name: "aimSlowHeavy100Bow20hp90",
    heavyHp: 100,
    heavyDamage: 16,
    heavyArmor: [0.1, 0.15, 0.2],
    heavySpeed: 1,
    archerHp: 90,
    archerDamage: 20
  },
  {
    name: "aimSlowHeavy100Bow20hp95",
    heavyHp: 100,
    heavyDamage: 16,
    heavyArmor: [0.1, 0.15, 0.2],
    heavySpeed: 1,
    archerHp: 95,
    archerDamage: 20
  },
  {
    name: "aimSlowHeavy100FullArmorBow20hp95",
    heavyHp: 100,
    heavyDamage: 16,
    heavyArmor: [0.1, 0.2, 0.3],
    heavySpeed: 1,
    archerHp: 95,
    archerDamage: 20
  },
  {
    name: "aimSlowFullArmorBow18hp75",
    heavyHp: 100,
    heavyDamage: 16,
    heavyArmor: [0.1, 0.2, 0.3],
    heavySpeed: 1,
    archerHp: 75,
    archerDamage: 18
  },
  {
    name: "aimSlowFullArmorBow18hp80",
    heavyHp: 100,
    heavyDamage: 16,
    heavyArmor: [0.1, 0.2, 0.3],
    heavySpeed: 1,
    archerHp: 80,
    archerDamage: 18
  },
  {
    name: "aimSlowFullArmorBow20hp75",
    heavyHp: 100,
    heavyDamage: 16,
    heavyArmor: [0.1, 0.2, 0.3],
    heavySpeed: 1,
    archerHp: 75,
    archerDamage: 20
  },
  {
    name: "aimSlowFullArmorBow20hp80",
    heavyHp: 100,
    heavyDamage: 16,
    heavyArmor: [0.1, 0.2, 0.3],
    heavySpeed: 1,
    archerHp: 80,
    archerDamage: 20
  },
  {
    name: "aimSlowFullArmorBow17hp80",
    heavyHp: 100,
    heavyDamage: 16,
    heavyArmor: [0.1, 0.2, 0.3],
    heavySpeed: 1,
    archerHp: 80,
    archerDamage: 17
  },
  {
    name: "aimJointA",
    heavyHp: 100,
    heavyDamage: 18,
    heavyArmor: [0.1, 0.15, 0.2],
    heavySpeed: 0.8,
    archerHp: 75,
    archerDamage: 20,
    shieldHp: 125,
    cavHp: 110,
    cavDamage: 13
  },
  {
    name: "aimJointB",
    heavyHp: 100,
    heavyDamage: 18,
    heavyArmor: [0.1, 0.15, 0.2],
    heavySpeed: 0.8,
    archerHp: 75,
    archerDamage: 20,
    shieldHp: 130,
    cavHp: 110,
    cavDamage: 12.5
  },
  {
    name: "aimJointC",
    heavyHp: 100,
    heavyDamage: 17.5,
    heavyArmor: [0.1, 0.15, 0.2],
    heavySpeed: 0.9,
    archerHp: 75,
    archerDamage: 20,
    shieldHp: 125,
    cavHp: 110,
    cavDamage: 12.5
  },
  {
    name: "aimJointD",
    heavyHp: 100,
    heavyDamage: 17,
    heavyArmor: [0.1, 0.15, 0.2],
    heavySpeed: 0.9,
    archerHp: 75,
    archerDamage: 18,
    shieldHp: 120,
    cavHp: 105,
    cavDamage: 12
  },
  {
    name: "aimJointE",
    heavyHp: 100,
    heavyDamage: 19,
    heavyArmor: [0.1, 0.15, 0.2],
    heavySpeed: 0.8,
    archerHp: 75,
    archerDamage: 20,
    shieldHp: 125,
    cavHp: 110,
    cavDamage: 13
  },
  {
    name: "aimJointF",
    heavyHp: 100,
    heavyDamage: 18.5,
    heavyArmor: [0.1, 0.15, 0.2],
    heavySpeed: 0.8,
    archerHp: 75,
    archerDamage: 20,
    shieldHp: 125,
    cavHp: 110,
    cavDamage: 13
  }
];
const kinds: UnitKind[] = ["shield", "heavy", "archer", "cavalry"];
const reports = variants.map((v) => {
  const profiles: Profiles = {
    ...FINAL_CANDIDATE,
    shield: { ...FINAL_CANDIDATE.shield, hp: v.shieldHp ?? 120 },
    cavalry: { ...FINAL_CANDIDATE.cavalry, hp: v.cavHp ?? 105, damage: v.cavDamage ?? 12 },
    heavy: {
      ...FINAL_CANDIDATE.heavy,
      hp: v.heavyHp,
      damage: v.heavyDamage,
      armor: v.heavyArmor as [number, number, number],
      speed: v.heavySpeed
    },
    archer: {
      ...FINAL_CANDIDATE.archer,
      hp: v.archerHp,
      damage: v.archerDamage,
      cost: v.archerDamage > 15 ? 110 : 90
    }
  };
  const duels = ([1, 2, 3] as Rank[]).flatMap((rank) =>
    kinds.flatMap((left, index) =>
      kinds
        .slice(index + 1)
        .map((right) => ({
          rank,
          left,
          right,
          ...summarize(army(left, rank, 1), army(right, rank, 1), profiles, 1)
        }))
    )
  );
  return { name: v.name, profiles, duels };
});
writeFileSync(
  "../resources/militarybalance/refinement.json",
  JSON.stringify(
    {
      method: {
        seeds: 32,
        trials: reports.length * 18 * 32,
        archerAimError: true,
        accuracy: [0.7, 0.8, 0.9],
        geometricContactCalibrationAt8: true,
        criticalOnlyOnFullHits: true,
        distance: 14
      },
      reports
    },
    null,
    2
  )
);
for (const r of reports) {
  if (!["aimJointE", "aimJointF"].includes(r.name)) continue;
  console.log(r.name);
  for (const d of r.duels) console.log(d.rank, d.left, d.right, d.wins, d.draws);
}
