import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  type ArmyMember,
  type Rank,
  RECOMMENDED,
  simulate,
  type UnitKind
} from "./military-balance-simulator";
const army = (kind: UnitKind, rank: Rank, count: number) =>
  Array.from({ length: count }, () => ({ kind, rank }));
const summarize = (
  left: ArmyMember[],
  right: ArmyMember[],
  profiles: typeof RECOMMENDED,
  lanes: number
) => {
  const runs = Array.from({ length: 32 }, (_, seed) =>
    simulate(left, right, profiles, 1000 + seed, { lanes })
  );
  const wins = [0, 0];
  for (const run of runs) if (run.winner >= 0) wins[run.winner]!++;
  return {
    seeds: 32,
    wins,
    draws: runs.filter((run) => run.winner < 0).length,
    leftWinShare: wins[0]! / 32,
    meanSeconds: runs.reduce((sum, run) => sum + run.seconds, 0) / 32,
    spent: runs[0]!.spent
  };
};
const variants = [6, 8].flatMap((archerRange) =>
  [false, true].map((extended) => ({
    archerRange,
    extended,
    profiles: {
      ...RECOMMENDED,
      shield: { ...RECOMMENDED.shield, range: 0.9 },
      heavy: { ...RECOMMENDED.heavy, range: extended ? 1 : 0.9 },
      cavalry: { ...RECOMMENDED.cavalry, range: extended ? 1.2 : 0.9 },
      archer: { ...RECOMMENDED.archer, range: archerRange }
    }
  }))
);
const pairs: [UnitKind, UnitKind][] = [
  ["shield", "heavy"],
  ["shield", "cavalry"],
  ["heavy", "cavalry"],
  ["archer", "shield"],
  ["archer", "cavalry"]
];
const duels = variants.flatMap((variant) =>
  ([1, 2, 3] as Rank[]).flatMap((rank) =>
    pairs.map(([left, right]) => ({
      archerRange: variant.archerRange,
      extended: variant.extended,
      rank,
      left,
      right,
      ...summarize(army(left, rank, 1), army(right, rank, 1), variant.profiles, 1)
    }))
  )
);
const mixed = variants.flatMap((variant) =>
  (["shield", "heavy"] as const).flatMap((screen) =>
    (["shield", "heavy"] as const).map((target) => ({
      archerRange: variant.archerRange,
      extended: variant.extended,
      rank: 2,
      screen,
      target,
      ...summarize(
        [...army(screen, 2, 4), ...army("archer", 2, 4)],
        army(target, 2, 8),
        variant.profiles,
        3
      )
    }))
  )
);
const report = {
  method: {
    approachDistance: 14,
    baselineReach: { shield: 0.9, heavy: 0.9, cavalry: 0.9, archer: 8 },
    proposedReach: { shield: 0.9, heavy: 1, cavalry: 1.2, archer: [6, 8] },
    caveat:
      "Ranges are proposed gameplay distances. No weapon/gait skeletal reach measurement or in-game attack animation validation was performed."
  },
  duels,
  mixed
};
writeFileSync(
  resolve("../resources/militarybalance/range-sweep.json"),
  JSON.stringify(report, null, 2)
);
console.log(JSON.stringify(report));
