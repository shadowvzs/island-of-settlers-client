import { writeFileSync } from "node:fs";

import {
  expectedDamage,
  type Profiles,
  type Rank,
  REFINED_CANDIDATE,
  simulate,
  type UnitKind
} from "./military-balance-simulator";
const army = (kind: UnitKind, rank: Rank, count: number) =>
  Array.from({ length: count }, () => ({ kind, rank }));
const rules = { archerAimError: true };
const control: Profiles = {
  ...REFINED_CANDIDATE,
  shield: { ...REFINED_CANDIDATE.shield, speed: 0.9 },
  heavy: { ...REFINED_CANDIDATE.heavy, speed: 0.8 },
  archer: { ...REFINED_CANDIDATE.archer, speed: 0.9 },
  cavalry: { ...REFINED_CANDIDATE.cavalry, speed: 1.8 }
};
const kinds: UnitKind[] = ["shield", "heavy", "archer", "cavalry"];
const profilesToCheck = [
  { name: "currentScaleControl", profiles: control },
  {
    name: "middleSpeedControl",
    profiles: {
      ...control,
      shield: { ...control.shield, speed: 1.2 },
      archer: { ...control.archer, speed: 1.2 },
      cavalry: { ...control.cavalry, speed: 2.4 }
    }
  }
];
const rows = profilesToCheck.flatMap(({ name, profiles }) =>
  ([1, 2, 3] as Rank[]).flatMap((rank) =>
    kinds.flatMap((left, index) =>
      kinds.slice(index + 1).map((right) => {
        const runs = Array.from({ length: 32 }, (_, seed) =>
          simulate(army(left, rank, 1), army(right, rank, 1), profiles, 1000 + seed, rules)
        );
        const wins = [0, 0];
        for (const r of runs) if (r.winner >= 0) wins[r.winner]!++;
        return { name, rank, left, right, wins, draws: runs.filter((r) => r.winner < 0).length };
      })
    )
  )
);
const middle = profilesToCheck[1]!.profiles;
const formations = ([1, 2, 3] as Rank[]).flatMap((rank) => {
  const shieldBow = [...army("shield", rank, 4), ...army("archer", rank, 3)];
  return (["shield", "heavy", "archer", "cavalry"] as UnitKind[]).map((target) => {
    const count = Math.floor(800 / middle[target].cost),
      right = army(target, rank, count);
    const runs = Array.from({ length: 32 }, (_, seed) =>
      simulate(shieldBow, right, middle, 1000 + seed, { ...rules, lanes: 3 })
    );
    const wins = [0, 0];
    for (const r of runs) if (r.winner >= 0) wins[r.winner]!++;
    return {
      rank,
      left: "shieldBow",
      right: target,
      wins,
      draws: runs.filter((r) => r.winner < 0).length,
      spent: runs[0]!.spent
    };
  });
});
const analytic = ([1, 2, 3] as Rank[]).map((rank) => {
  const heavyDps =
    expectedDamage({ kind: "heavy", rank }, { kind: "shield", rank }, REFINED_CANDIDATE) / 1.2;
  const shieldDps = expectedDamage(
    { kind: "shield", rank },
    { kind: "heavy", rank },
    REFINED_CANDIDATE
  );
  return {
    rank,
    heavyDps,
    shieldDps,
    heavyKillSeconds: (REFINED_CANDIDATE.shield.hp * Math.pow(1.2, rank - 1)) / heavyDps,
    shieldKillSeconds: (REFINED_CANDIDATE.heavy.hp * Math.pow(1.2, rank - 1)) / shieldDps
  };
});
const report = {
  method: {
    trials: (rows.length + formations.length) * 32,
    seeds: 32,
    distance: 14,
    profiles: profilesToCheck,
    proxy:
      "Same geometric aim error proxy as refinement; no live terrain or arrow/body movement intersection. Speeds selected as bounded current-game control, not a balanced recommendation."
  },
  analytic,
  rows,
  formations
};
writeFileSync(
  "../resources/militarybalance/moderator-checks.json",
  JSON.stringify(report, null, 2)
);
console.log(JSON.stringify(report));
