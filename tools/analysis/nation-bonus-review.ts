import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ARCHER_SHIELD_DAMAGE_MULTIPLIER, GARRISON_POST_MAX_RANGE_FACTOR, MILITARY_PROFILES }
  from "../../src/shared/balance/military";
import { ORDINARY_TROOP_TYPES } from "../../src/shared/settlement/military-combat-rules";

/** Exact finite-state expectation for full hits; no terrain, misses, retaliation or win-rate claim. */
const expectedHits = (hp: number, normalDamage: number, outcomes: readonly [number, number][]) => {
  const threshold = Math.ceil((hp - 1e-9) / (normalDamage / 2));
  const expectation = new Float64Array(threshold + 5);
  for (let damage = threshold - 1; damage >= 0; damage--)
    expectation[damage] = 1 + outcomes.reduce((sum, [halfHits, probability]) =>
      sum + probability * expectation[damage + halfHits]!, 0);
  return expectation[0]!;
};

const shotComparisons = [0, 1, 2].flatMap(rank => ORDINARY_TROOP_TYPES.map(defender => {
  const target = MILITARY_PROFILES[defender], archer = MILITARY_PROFILES.archer;
  const shieldShare = defender === "shield" ? ARCHER_SHIELD_DAMAGE_MULTIPLIER : 1;
  const normal = archer.damage * 1.2 ** rank * shieldShare * (1 - target.armour[rank]!);
  const hp = target.hp * 1.2 ** rank, rankCritical = rank * .05;
  const base: [number, number][] = [[2, 1 - rankCritical], [3, rankCritical]];
  // Recommended stacking rule: national double replaces a rank critical, never creates a triple hit.
  const chinese: [number, number][] = [[2, .95 * (1 - rankCritical)], [3, .95 * rankCritical], [4, .05]];
  const baselineHits = expectedHits(hp, normal, base), chineseHits = expectedHits(hp, normal, chinese);
  const baselineMultiplier = 1 + .5 * rankCritical;
  const chineseMultiplier = .05 * 2 + .95 * baselineMultiplier;
  return { rank, defender, hp, normalDamage: normal, baselineHits, chineseHits,
    expectedDamageGain: chineseMultiplier / baselineMultiplier - 1,
    assumptions: "Same rank, every shot hits full contact; no stacked triple critical." };
}));

const range = MILITARY_PROFILES.archer.range, minimum = MILITARY_PROFILES.archer.minimumRange;
const ranged = range * 1.1, postRange = range * GARRISON_POST_MAX_RANGE_FACTOR;
const report = {
  status: "Design analysis only; no gameplay modifiers implemented or match balance certified",
  profiles: Object.fromEntries(ORDINARY_TROOP_TYPES.map(type => [type, MILITARY_PROFILES[type]])),
  chinese: { chance: .05, multiplier: 2, independentStackedExpectedDamageGain: .05,
    recommendedCriticalStacking: "National double replaces the rank critical for this hit; cap at double.",
    shotComparisons, chanceOfAtLeastOneNationalCriticalIn20Hits: 1 - .95 ** 20 },
  nubian: { bonus: .1, baseRange: range, proposedRange: ranged, extraTiles: ranged - range,
    potentialOpenGroundAnnulusGain: (ranged ** 2 - minimum ** 2) / (range ** 2 - minimum ** 2) - 1,
    openingTimeAgainstShield: (ranged - range) / MILITARY_PROFILES.shield.speed,
    openingTimeAgainstHeavy: (ranged - range) / MILITARY_PROFILES.heavy.speed,
    currentMaximumTowerRange: postRange, naiveStackedTowerRange: ranged * GARRISON_POST_MAX_RANGE_FACTOR,
    recommendation: "Use max(national range factor, height factor), not their product; preserve tower cap." },
  indigenous: { proposedSpeedBonus: .15, travelTimeReduction: 1 - 1 / 1.15,
    profiles: Object.fromEntries(ORDINARY_TROOP_TYPES.map(type => [type, {
      before: MILITARY_PROFILES[type].speed, after: MILITARY_PROFILES[type].speed * 1.15,
      twentyTileTravelBefore: 20 / MILITARY_PROFILES[type].speed,
      twentyTileTravelAfter: 20 / (MILITARY_PROFILES[type].speed * 1.15)
    }])), recommendation: "Military movement only; retain attack intervals and navigation radii. Test kiting/formations." },
  roman: { proposedConstructionSpeedBonus: .05, constructionTimeRatio: 1 / 1.05,
    timeReduction: 1 - 1 / 1.05,
    meaning: "Owner restored faster construction; beer unchanged. Materials, delivery and routing stay unchanged." },
  assessment: "Nubian range and Indigenous mobility are broader tactical advantages than Chinese expected damage. " +
    "Faster Roman construction benefits many building chains; the complete economy+military pair needs playtests.",
  requiredAcceptance: ["Field ranged matchups, mixed formations, pursuit/retreat and kiting",
    "Garrison/colony assault with the existing tower-range difficulty gates",
    "Deterministic critical outcomes across saves, replay, projectile flight and shooter death",
    "Active/offline production parity with all existing level/talent multipliers"]
};
const output = resolve("../resources/project-reviews/nation-bonuses");
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, "design-analysis.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ chineseDamageGainByRank: shotComparisons.filter(row => row.defender === "archer")
  .map(row => ({ rank: row.rank, gain: row.expectedDamageGain })), nubian: report.nubian,
indigenous: report.indigenous, roman: report.roman }, null, 2));
