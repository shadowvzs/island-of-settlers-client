import { writeFileSync } from "node:fs";

import { FINAL_CANDIDATE, type Rank, simulate, type UnitKind } from "./military-balance-simulator";
const army = (kind: UnitKind, rank: Rank, count: number) =>
  Array.from({ length: count }, () => ({ kind, rank }));
const rows = [95, 105, 115].flatMap((hp) =>
  ([1, 2, 3] as Rank[]).flatMap((rank) =>
    (["shield", "heavy", "archer"] as UnitKind[]).flatMap((target) =>
      [1, 6].map((count) => {
        const profiles = { ...FINAL_CANDIDATE, cavalry: { ...FINAL_CANDIDATE.cavalry, hp } };
        const runs = Array.from({ length: 32 }, (_, seed) =>
          simulate(army("cavalry", rank, count), army(target, rank, count), profiles, 1000 + seed, {
            lanes: count === 1 ? 1 : 3
          })
        );
        const wins = [0, 0];
        for (const run of runs) if (run.winner >= 0) wins[run.winner]!++;
        return {
          hp,
          rank,
          target,
          count,
          wins,
          draws: runs.filter((r) => r.winner < 0).length,
          cavalryWinShare: wins[0]! / 32,
          spent: runs[0]!.spent
        };
      })
    )
  )
);
const profiles = FINAL_CANDIDATE;
const mixed = ([1, 2, 3] as Rank[]).flatMap((rank) =>
  (["shield", "heavy"] as const).flatMap((screen) =>
    (["shield", "heavy", "cavalry"] as UnitKind[]).map((target) => {
      const left = [...army(screen, rank, 4), ...army("archer", rank, 4)],
        right = army(target, rank, target === "cavalry" ? 6 : 8);
      const runs = Array.from({ length: 32 }, (_, seed) =>
        simulate(left, right, profiles, 1000 + seed, { lanes: 3 })
      );
      const wins = [0, 0];
      for (const run of runs) if (run.winner >= 0) wins[run.winner]!++;
      return {
        rank,
        screen,
        target,
        wins,
        draws: runs.filter((r) => r.winner < 0).length,
        leftWinShare: wins[0]! / 32,
        spent: runs[0]!.spent
      };
    })
  )
);
const report = {
  method: {
    seeds: 32,
    profiles: FINAL_CANDIDATE,
    trials: rows.length * 32 + mixed.length * 32,
    archerDamage: 15,
    archerInterval: 1.8,
    reach: { shield: 0.9, heavy: 1, cavalry: 1.2, archer: 8 },
    equalCountsNotEqualCosts: true
  },
  rows,
  mixed
};
writeFileSync("../resources/militarybalance/final-tuning.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(mixed));
