import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  type ArmyMember,
  CANDIDATE,
  DEFAULT_RULES,
  expectedDamage,
  landedDamage,
  type Profiles,
  type Rank,
  RECOMMENDED,
  type Rules,
  simulate,
  type UnitKind
} from "./military-balance-simulator";
const output = resolve("../resources/militarybalance");
mkdirSync(output, { recursive: true });
const kinds: UnitKind[] = ["shield", "heavy", "archer", "cavalry"],
  ranks: Rank[] = [1, 2, 3];
const member = (kind: UnitKind, rank: Rank): ArmyMember => ({ kind, rank });
const army = (kind: UnitKind, rank: Rank, count: number) =>
  Array.from({ length: count }, () => member(kind, rank));
const samples = (
  left: ArmyMember[],
  right: ArmyMember[],
  profiles: Profiles,
  rules: Partial<Rules>,
  count = 32
) => {
  const runs = Array.from({ length: count }, (_, seed) =>
    simulate(left, right, profiles, 1000 + seed, rules)
  );
  const wins = [0, 0],
    draws = runs.filter((run) => run.winner === -1).length;
  for (const run of runs) if (run.winner >= 0) wins[run.winner]!++;
  return {
    runs: count,
    wins,
    draws,
    leftWinShare: wins[0]! / count,
    meanSeconds: runs.reduce((s, r) => s + r.seconds, 0) / count,
    meanSurvivors: [0, 1].map((team) => runs.reduce((s, r) => s + r.survivors[team]!, 0) / count),
    meanRemainingHP: [0, 1].map((team) => runs.reduce((s, r) => s + r.remaining[team]!, 0) / count),
    spent: runs[0]!.spent
  };
};
const analytic = (profiles: Profiles) =>
  ranks.flatMap((rank) =>
    kinds.flatMap((attacker) =>
      kinds.map((target) => {
        const source = member(attacker, rank),
          victim = member(target, rank),
          damage = expectedDamage(source, victim, profiles);
        const hp = profiles[target].hp * Math.pow(1.2, rank - 1),
          dps = damage / profiles[attacker].interval;
        return {
          rank,
          attacker,
          target,
          expectedHitDamage: damage,
          expectedDps: dps,
          continuousKillSeconds: hp / dps
        };
      })
    )
  );
const duelReview = (profiles: Profiles) =>
  ranks.flatMap((rank) =>
    kinds.flatMap((left, i) =>
      kinds.slice(i + 1).flatMap((right) =>
        [0.8, 14].map((distance) => ({
          left,
          right,
          rank,
          distance,
          ...samples(
            army(left, rank, 1),
            army(right, rank, 1),
            profiles,
            { distance, lanes: 1 },
            64
          )
        }))
      )
    )
  );
const equalBudget = (profiles: Profiles) =>
  ranks.flatMap((rank) =>
    kinds.flatMap((left, i) =>
      kinds.slice(i + 1).flatMap((right) =>
        [3, 6].map((lanes) => ({
          left,
          right,
          rank,
          lanes,
          budget: 1000,
          leftCount: Math.floor(1000 / profiles[left].cost),
          rightCount: Math.floor(1000 / profiles[right].cost),
          ...samples(
            army(left, rank, Math.floor(1000 / profiles[left].cost)),
            army(right, rank, Math.floor(1000 / profiles[right].cost)),
            profiles,
            { lanes },
            24
          )
        }))
      )
    )
  );
const mixedTeams = (rank: Rank) => ({
  allShield: army("shield", rank, 8),
  allHeavy: army("heavy", rank, 8),
  allArcher: army("archer", rank, 8),
  allCavalry: army("cavalry", rank, 4),
  shieldScreen: [...army("shield", rank, 4), ...army("archer", rank, 4)],
  heavyScreen: [...army("heavy", rank, 4), ...army("archer", rank, 4)],
  balanced: [
    ...army("shield", rank, 2),
    ...army("heavy", rank, 2),
    ...army("archer", rank, 2),
    ...army("cavalry", rank, 1)
  ]
});
const mixedReview = (profiles: Profiles) =>
  ranks.flatMap((rank) => {
    const teams = mixedTeams(rank),
      keys = Object.keys(teams) as (keyof typeof teams)[];
    return keys.flatMap((left, i) =>
      keys.slice(i + 1).map((right) => ({
        left,
        right,
        rank,
        lanes: 3,
        ...samples(teams[left], teams[right], profiles, { lanes: 3 }, 24)
      }))
    );
  });
const tierReview = (profiles: Profiles) =>
  kinds.flatMap((kind) =>
    [
      [1, 2],
      [2, 3],
      [1, 3]
    ].map(([low, high]) => ({
      kind,
      low,
      high,
      ...samples(
        army(kind, low as Rank, 1),
        army(kind, high as Rank, 1),
        profiles,
        { lanes: 1 },
        64
      )
    }))
  );
const alternatives = {
  candidate: CANDIDATE,
  recommended: RECOMMENDED,
  largerHeavy: {
    ...RECOMMENDED,
    heavy: { ...CANDIDATE.heavy, hp: 115, damage: 14.5, interval: 1.25 }
  },
  cavalry140: { ...RECOMMENDED, cavalry: { ...RECOMMENDED.cavalry, cost: 140 } },
  cavalry200: { ...RECOMMENDED, cavalry: { ...RECOMMENDED.cavalry, cost: 200 } },
  cavalry180: { ...RECOMMENDED, cavalry: { ...RECOMMENDED.cavalry, cost: 180 } }
};
const variants = Object.entries(alternatives).map(([name, profiles]) => ({
  name,
  profiles,
  analytic: analytic(profiles),
  duels: duelReview(profiles),
  equalBudget: equalBudget(profiles),
  mixed: mixedReview(profiles),
  tiers: tierReview(profiles)
}));
const sensitivity = Object.entries({
  range6: { rangeMultiplier: 0.75 },
  range10: { rangeMultiplier: 1.25 },
  slowCavalry: { cavalrySpeedMultiplier: 0.75 },
  fastCavalry: { cavalrySpeedMultiplier: 1.25 },
  noCritical: { critical: false },
  armorMinus5: { armorOffset: -0.05 },
  armorPlus5: { armorOffset: 0.05 },
  openFront: { lanes: 6 },
  narrowFront: { lanes: 1 }
}).flatMap(([name, override]) =>
  ranks.flatMap((rank) => {
    const teams = mixedTeams(rank);
    return (
      [
        ["shieldScreen", "allHeavy"],
        ["heavyScreen", "allCavalry"],
        ["allArcher", "allShield"],
        ["allCavalry", "allShield"]
      ] as const
    ).map(([left, right]) => ({
      name,
      left,
      right,
      rank,
      override,
      ...samples(teams[left], teams[right], RECOMMENDED, override, 24)
    }));
  })
);
const symmetry = ranks.flatMap((rank) =>
  kinds.map((kind) => ({
    kind,
    rank,
    ...samples(army(kind, rank, 6), army(kind, rank, 6), RECOMMENDED, { lanes: 3 }, 64)
  }))
);
// Exact agreed formulas, independent of random outcomes.
const rules = DEFAULT_RULES;
assert.equal(landedDamage(member("shield", 1), member("archer", 1), CANDIDATE, rules), 9.5);
assert(
  Math.abs(landedDamage(member("archer", 1), member("shield", 1), CANDIDATE, rules) - 5.36) < 1e-10
);
assert(
  Math.abs(landedDamage(member("heavy", 1), member("shield", 3), CANDIDATE, rules) - 7.8) < 1e-10
);
assert.equal(
  landedDamage(member("heavy", 1), member("shield", 3), CANDIDATE, rules, false, true),
  13
);
assert(
  Math.abs(expectedDamage(member("heavy", 1), member("shield", 3), CANDIDATE, rules) - 9.516) < 1e-10
);
assert(
  Math.abs(landedDamage(member("cavalry", 1), member("heavy", 1), CANDIDATE, rules) - 14.364) <
    1e-10
);
assert.deepEqual(
  simulate(army("shield", 2, 4), army("archer", 2, 4), RECOMMENDED, 19),
  simulate(army("shield", 2, 4), army("archer", 2, 4), RECOMMENDED, 19)
);
const stepSensitivity = [0.025, 0.05, 0.1].map((step) => ({
  step,
  ...samples(mixedTeams(2).shieldScreen, mixedTeams(2).allHeavy, RECOMMENDED, { step }, 32)
}));
const report = {
  method: {
    model: "Seeded offline 2D narrow/open front approximation",
    seeds: "LCG seeds 1000..1063, same batches for variants",
    contactDuelDistance: 0.8,
    tick: 0.05,
    distance: 14,
    arrowSpeed: 10,
    collisionRadius: 0.3,
    miss: [0.3, 0.2, 0.1],
    rankCritical: [0, 0.05, 0.1],
    criticalMultiplier: 1.5,
    hpTierMultiplier: 1.2,
    armorBypass:
      "On each landed heavy attack, an independent 33% Bernoulli roll ignores all target armor; expected damage matches armor*.67 but duels retain variance",
    damageFormula:
      "baseDamage * classMultiplier * (heavyArmorBypassProc?1:1-armor) * (rankCritical?1.5:1); bow misses produce zero damage",
    assumptions: [
      "Same base hit damage and attack interval across ranks",
      "Archers stop in range, never kite automatically",
      "Nearest living enemy targets; frontline screens physically, arrows shoot over allies",
      "No terrain slopes, flanking tactics, pursuit fatigue, formations, ranged interception or shields blocking neighbours",
      "Melee always hits; fixed arrow hit probability by rank, no distance accuracy penalty",
      "Cost is an analyst normalization, not approved production recipes; rank training has no budget price here",
      "No nation bonus, class-critical bonus, spear or mounted implementation",
      "Cavalry conceptual speed only; horse production cost and logistics must be verified in game"
    ],
    limitation: "This model checks numbers and sensitivity; it cannot prove actual game balance."
  },
  variants,
  sensitivity,
  symmetry,
  stepSensitivity
};
writeFileSync(resolve(output, "review.json"), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      variants: variants.map((v) => ({
        name: v.name,
        duels: v.duels.length,
        equalBudget: v.equalBudget.length,
        mixed: v.mixed.length
      })),
      sensitivity: sensitivity.length,
      symmetry,
      stepSensitivity
    },
    null,
    2
  )
);
