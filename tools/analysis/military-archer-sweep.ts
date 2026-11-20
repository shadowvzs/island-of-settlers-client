import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  expectedDamage,
  type Rank,
  RECOMMENDED,
  simulate,
  type UnitKind
} from "./military-balance-simulator";
const army = (kind: UnitKind, rank: Rank, count: number) =>
  Array.from({ length: count }, () => ({ kind, rank }));
const variants = [
  { name: "baseline10/1.4", damage: 10, interval: 1.4 },
  { name: "moderate12/1.4", damage: 12, interval: 1.4 },
  { name: "burst15/1.8", damage: 15, interval: 1.8 },
  { name: "strong15/1.4", damage: 15, interval: 1.4 }
];
const scenarios = ([1, 2, 3] as Rank[]).flatMap((rank) =>
  (["shield", "heavy"] as const).flatMap((screen) =>
    (["shield", "heavy"] as const).map((target) => ({ rank, screen, target, lanes: 3 }))
  )
);
scenarios.push(
  ...([1, 6] as const).flatMap((lanes) =>
    (["shield", "heavy"] as const).map((target) => ({
      rank: 2 as Rank,
      screen: "shield" as const,
      target,
      lanes
    }))
  )
);
const rows = variants.flatMap((variant) =>
  scenarios.map(({ lanes, rank, screen, target }) => {
    const profiles = {
      ...RECOMMENDED,
      archer: { ...RECOMMENDED.archer, damage: variant.damage, interval: variant.interval }
    };
    const left = [...army(screen, rank, 4), ...army("archer", rank, 4)],
      right = army(target, rank, 8);
    const runs = Array.from({ length: 32 }, (_, seed) =>
      simulate(left, right, profiles, 1000 + seed, { lanes })
    );
    const wins = [0, 0];
    for (const run of runs) if (run.winner >= 0) wins[run.winner]!++;
    const living = runs.reduce((sum, run) => sum + run.livingSecondsByKind[0].archer, 0);
    const shots = runs.reduce((sum, run) => sum + run.attacksByKind[0].archer, 0);
    return {
      ...variant,
      rank,
      screen,
      target,
      lanes,
      seeds: 32,
      wins,
      draws: runs.filter((run) => run.winner < 0).length,
      leftWinShare: wins[0]! / 32,
      meanSeconds: runs.reduce((sum, run) => sum + run.seconds, 0) / 32,
      meanArcherShots: shots / 32,
      meanArcherLivingSeconds: living / 32,
      archerFiringUptime: (shots * variant.interval) / living,
      expectedArcherDps:
        expectedDamage({ kind: "archer", rank }, { kind: target, rank }, profiles) /
        variant.interval,
      leftCost: runs[0]!.spent[0],
      rightCost: runs[0]!.spent[1]
    };
  })
);
const report = {
  method: {
    seeds: "1000..1031",
    metric:
      "Firing uptime = shots*interval/summed archer living seconds; includes approach time; initial instant attack may slightly overstate one short fight",
    limits:
      "Nearest-front target focus and narrow lane collisions change ranged uptime. No automatic kiting; no incoming-arrow shielding for neighbouring units; mixed compositions use comparable rather than identical total cost."
  },
  rows
};
writeFileSync(
  resolve("../resources/militarybalance/archer-sweep.json"),
  JSON.stringify(report, null, 2)
);
console.log(
  JSON.stringify(
    rows
      .filter((row) => row.lanes === 3)
      .map((row) => ({
        variant: row.name,
        rank: row.rank,
        screen: row.screen,
        target: row.target,
        win: row.leftWinShare,
        uptime: row.archerFiringUptime
      })),
    null,
    2
  )
);
