import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

import {
  arrowContactProbabilities,
  FINAL_CANDIDATE,
  type Profiles,
  type Rank,
  REFINED_CANDIDATE,
  simulate,
  type UnitKind
} from "./military-balance-simulator";
const army = (kind: UnitKind, rank: Rank, count: number) =>
  Array.from({ length: count }, () => ({ kind, rank }));
const compositions = (rank: Rank, profiles: Profiles) => ({
  shield: army("shield", rank, 8),
  heavy: army("heavy", rank, 8),
  archer: army("archer", rank, Math.floor(800 / profiles.archer.cost)),
  cavalry: army("cavalry", rank, Math.floor(800 / profiles.cavalry.cost)),
  shieldBow: [...army("shield", rank, 4), ...army("archer", rank, 3)],
  heavyBow: [...army("heavy", rank, 4), ...army("archer", rank, 3)],
  mixed: [
    ...army("shield", rank, 2),
    ...army("heavy", rank, 2),
    ...army("archer", rank, 2),
    ...army("cavalry", rank, 1)
  ]
});
const summarize = (
  left: ReturnType<typeof army>,
  right: ReturnType<typeof army>,
  profiles: Profiles,
  lanes: number,
  step = 0.05,
  distance = 14
) => {
  const runs = Array.from({ length: 32 }, (_, seed) =>
    simulate(left, right, profiles, 1000 + seed, { lanes, step, distance, archerAimError: true })
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
const formations = ([1, 2, 3] as Rank[]).flatMap((rank) =>
  [1, 3, 6].flatMap((lanes) => {
    const armies = compositions(rank, REFINED_CANDIDATE),
      entries = Object.entries(armies);
    return entries.flatMap(([left, l], index) =>
      entries
        .slice(index + 1)
        .map(([right, r]) => ({
          rank,
          lanes,
          left,
          right,
          ...summarize(l, r, REFINED_CANDIDATE, lanes)
        }))
    );
  })
);
const baseline = ([1, 2, 3] as Rank[]).flatMap((rank) => {
  const armies = compositions(rank, FINAL_CANDIDATE),
    entries = Object.entries(armies);
  return entries.flatMap(([left, l], index) =>
    entries
      .slice(index + 1)
      .map(([right, r]) => ({
        rank,
        lanes: 3,
        left,
        right,
        ...summarize(l, r, FINAL_CANDIDATE, 3)
      }))
  );
});
const bounds = ([0.8, 8, 20] as const).flatMap((distance) =>
  ([0.025, 0.1] as const).flatMap((step) =>
    ([1, 2, 3] as Rank[]).flatMap((rank) => {
      const pairs: [UnitKind, UnitKind][] = [
        ["heavy", "archer"],
        ["shield", "heavy"],
        ["heavy", "cavalry"]
      ];
      return pairs.map(([left, right]) => ({
        distance,
        step,
        rank,
        left,
        right,
        ...summarize(
          army(left, rank, 1),
          army(right, rank, 1),
          REFINED_CANDIDATE,
          1,
          step,
          distance
        )
      }));
    })
  )
);
for (const rank of [1, 2, 3] as Rank[])
  assert(Math.abs(arrowContactProbabilities(8, rank).full - [0.7, 0.8, 0.9][rank - 1]!) < 1e-12);
assert(arrowContactProbabilities(4, 1).miss < arrowContactProbabilities(8, 1).miss);
assert(arrowContactProbabilities(12, 1).miss > arrowContactProbabilities(8, 1).miss);
const report = {
  method: {
    seeds: 32,
    trials: (formations.length + baseline.length + bounds.length) * 32,
    profiles: REFINED_CANDIDATE,
    aim: "Stationary circular silhouette Gaussian angular dispersion proxy, not live ballistic mesh collisions. Full70/80/90 calibration ONLY at8cells; outer rim glancing, misses0damage; no second hit roll.",
    formationCosts:
      "Pure armies max800 relative budget; mixed armies730/760, so comparable costs rather than identical.",
    collisionLimits:
      "Planar circular units, nearest enemy, no kite, no flanking orders, no terrain or height, no moving-target predictive aim."
  },
  contacts: ([1, 2, 3] as Rank[]).flatMap((rank) =>
    [4, 8, 12].map((distance) => ({ rank, distance, ...arrowContactProbabilities(distance, rank) }))
  ),
  formations,
  baseline,
  bounds
};
writeFileSync(
  "../resources/militarybalance/refinement-formations.json",
  JSON.stringify(report, null, 2)
);
console.log(JSON.stringify(formations.filter((r) => r.lanes === 3)));
