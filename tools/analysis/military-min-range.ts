import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

import {
  type Profiles,
  type Rank,
  REFINED_CANDIDATE,
  simulate,
  type UnitKind
} from "./military-balance-simulator";
const profiles: Profiles = {
  ...REFINED_CANDIDATE,
  shield: { ...REFINED_CANDIDATE.shield, speed: 1.2 },
  archer: { ...REFINED_CANDIDATE.archer, speed: 1.2 },
  cavalry: { ...REFINED_CANDIDATE.cavalry, speed: 2.4 }
};
const army = (kind: UnitKind, rank: Rank, count: number) =>
  Array.from({ length: count }, () => ({ kind, rank }));
const variants = [
  { name: "historical0-8", min: 0, retreat: false },
  { name: "comparison2-8stationary", min: 2, retreat: false },
  { name: "confirmed2-8boundedRetreat", min: 2, retreat: true }
];
const summarize = (
  left: ReturnType<typeof army>,
  right: ReturnType<typeof army>,
  variant: (typeof variants)[number],
  distance: number,
  lanes: number,
  duel: boolean
) => {
  const runs = Array.from({ length: 32 }, (_, seed) =>
    simulate(left, right, profiles, 1000 + seed, {
      distance,
      lanes,
      archerAimError: true,
      archerMinRange: variant.min,
      archerRetreat: variant.retreat,
      archerRearOffset: duel ? 0 : 2.2
    })
  );
  const wins = [0, 0];
  for (const run of runs) if (run.winner >= 0) wins[run.winner]!++;
  for (const run of runs) {
    if (run.archerMinReleaseDistance !== null)
      assert(run.archerMinReleaseDistance >= variant.min - 1e-9);
    if (variant.retreat) assert(run.archerMaxBackoffExcursion <= 4 + 1e-9);
  }
  return {
    wins,
    draws: runs.filter((r) => r.winner < 0).length,
    leftWinShare: wins[0]! / 32,
    meanSeconds: runs.reduce((sum, r) => sum + r.seconds, 0) / 32,
    meanArcherShots: runs.reduce((sum, r) => sum + r.attacksByKind[0].archer, 0) / 32,
    minReleaseDistance: Math.min(...runs.map((r) => r.archerMinReleaseDistance ?? Infinity)),
    maxBackoffExcursion: Math.max(...runs.map((r) => r.archerMaxBackoffExcursion)),
    meanBackoffStarts: runs.reduce((sum, r) => sum + r.archerBackoffStarts, 0) / 32,
    spent: runs[0]!.spent
  };
};
const duels = variants.flatMap((variant) =>
  ([1, 2, 3] as Rank[]).flatMap((rank) =>
    ([0.8, 2, 8, 14] as const).flatMap((distance) =>
      (["shield", "heavy", "cavalry"] as UnitKind[]).map((target) => ({
        variant: variant.name,
        rank,
        distance,
        target,
        ...summarize(army("archer", rank, 1), army(target, rank, 1), variant, distance, 1, true)
      }))
    )
  )
);
const mixed = variants.flatMap((variant) =>
  ([1, 2, 3] as Rank[]).flatMap((rank) =>
    (["shield", "heavy", "cavalry"] as UnitKind[]).map((target) => ({
      variant: variant.name,
      rank,
      target,
      ...summarize(
        [...army("shield", rank, 4), ...army("archer", rank, 3)],
        army(target, rank, Math.floor(800 / profiles[target].cost)),
        variant,
        14,
        3,
        false
      )
    }))
  )
);
const noCloseFire = simulate(army("archer", 1, 1), army("shield", 1, 1), profiles, 1000, {
  distance: 0.8,
  lanes: 1,
  archerRearOffset: 0,
  archerMinRange: 2,
  archerAimError: true
});
assert.equal(noCloseFire.attacksByKind[0].archer, 0);
const report = {
  method: {
    trials: (duels.length + mixed.length) * 32,
    seeds: 32,
    profiles,
    authoritativeRange: [2, 8],
    allRanksSameRange: true,
    automaticRetreatRequired: true,
    backoffParameters: {
      triggerInside: 2,
      targetSeparation: 3.5,
      assignedAnchorRadius: 4,
      blockedRetrySeconds: 0.3,
      numbersProposed: true
    },
    movement:
      "Stand to fire. Inside minimum, retreat if configured, no advance into enemy. Proxy also bounds automatic archer approach by anchor4. No player-ordered anchor updates modeled.",
    aim: "Geometric stationary silhouette dispersion remains calibrated at8cells, never recalibrated from max range. Prior target retained on shot; actual curved swept-contact physics absent.",
    nav: "Planar existing circles and frontage bounds only. No terrain or real paths; no far-target eligibility/clear-ray selection modeled.",
    duelStart: "Archer rear offset disabled so listed startdistance is exact.",
    mixedStart: "Historical archer rear offset2.2 retained for formations."
  },
  duels,
  mixed,
  assertions:
    "No release below minimum; bounded retreat <=4; close stationary archer emits zero shots."
};
writeFileSync("../resources/militarybalance/min-range.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(mixed));
