/** Offline balance approximation. Never imported by the live game. */
export type UnitKind = "shield" | "heavy" | "archer" | "cavalry";
export type Rank = 1 | 2 | 3;
export interface Profile {
  hp: number;
  damage: number;
  interval: number;
  armor: readonly [number, number, number];
  cost: number;
  speed: number;
  range: number;
}
export type Profiles = Record<UnitKind, Profile>;
export const CANDIDATE: Profiles = {
  shield: {
    hp: 120,
    damage: 10,
    interval: 1,
    armor: [0.2, 0.3, 0.4],
    cost: 100,
    speed: 1.8,
    range: 0.9
  },
  heavy: {
    hp: 100,
    damage: 13,
    interval: 1.2,
    armor: [0.1, 0.2, 0.3],
    cost: 100,
    speed: 1.8,
    range: 0.9
  },
  archer: {
    hp: 75,
    damage: 10,
    interval: 1.4,
    armor: [0.05, 0.1, 0.15],
    cost: 90,
    speed: 1.7,
    range: 8
  },
  cavalry: {
    hp: 130,
    damage: 12,
    interval: 1.3,
    armor: [0.1, 0.2, 0.3],
    cost: 140,
    speed: 3.6,
    range: 0.9
  }
};
// Intermediate profile retained to reproduce the original broad comparison reports.
export const RECOMMENDED: Profiles = {
  ...CANDIDATE,
  heavy: { ...CANDIDATE.heavy, damage: 16 },
  cavalry: { ...CANDIDATE.cavalry, cost: 160 }
};
// Final proposal: jointly checked in military-final-tuning.ts; not live-game balance.
export const FINAL_CANDIDATE: Profiles = {
  ...RECOMMENDED,
  heavy: { ...RECOMMENDED.heavy, range: 1 },
  archer: { ...RECOMMENDED.archer, damage: 15, interval: 1.8 },
  cavalry: { ...RECOMMENDED.cavalry, hp: 105, cost: 140, range: 1.2 }
};
/** Refinement stress candidate; advocate review and live collision checks still required. */
export const REFINED_CANDIDATE: Profiles = {
  ...FINAL_CANDIDATE,
  shield: { ...FINAL_CANDIDATE.shield, hp: 125 },
  heavy: { ...FINAL_CANDIDATE.heavy, damage: 19, armor: [0.1, 0.15, 0.2], speed: 0.8 },
  archer: { ...FINAL_CANDIDATE.archer, damage: 20, cost: 110 },
  cavalry: { ...FINAL_CANDIDATE.cavalry, hp: 110, damage: 13 }
};
export interface ArmyMember {
  kind: UnitKind;
  rank: Rank;
}
interface Unit extends ArmyMember {
  team: number;
  hp: number;
  maxHp: number;
  x: number;
  z: number;
  ready: number;
  anchorX: number;
  anchorZ: number;
  retreating: boolean;
  backoffReady: number;
}
interface Shot {
  at: number;
  target: Unit;
  damage: number;
}
export interface Rules {
  distance: number;
  lanes: number;
  limit: number;
  step: number;
  rangeMultiplier: number;
  cavalrySpeedMultiplier: number;
  critical: boolean;
  armorOffset: number;
  archerGlancing: boolean;
  archerAimError: boolean;
  archerMinRange: number;
  archerRearOffset: number;
  archerRetreat: boolean;
  archerRetreatLimit: number;
  archerRetreatSeparation: number;
}
export const DEFAULT_RULES: Rules = {
  distance: 14,
  lanes: 3,
  limit: 120,
  step: 0.05,
  rangeMultiplier: 1,
  cavalrySpeedMultiplier: 1,
  critical: true,
  armorOffset: 0,
  archerGlancing: false,
  archerAimError: false,
  archerMinRange: 0,
  archerRearOffset: 2.2,
  archerRetreat: false,
  archerRetreatLimit: 4,
  archerRetreatSeparation: 3.5
};
export interface Outcome {
  attacksByKind: [Record<UnitKind, number>, Record<UnitKind, number>];
  livingSecondsByKind: [Record<UnitKind, number>, Record<UnitKind, number>];
  archerMinReleaseDistance: number | null;
  archerBackoffStarts: number;
  archerMaxBackoffExcursion: number;
  winner: number;
  seconds: number;
  remaining: [number, number];
  survivors: [number, number];
  spent: [number, number];
  attacks: [number, number];
  damage: [number, number];
}
const randomFor = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const distance = (a: Unit, b: Unit) => Math.hypot(a.x - b.x, a.z - b.z);
const armorOf = (unit: ArmyMember, profiles: Profiles, rules: Rules) =>
  Math.max(0, Math.min(0.75, profiles[unit.kind].armor[unit.rank - 1]! + rules.armorOffset));
export const landedDamage = (
  attacker: ArmyMember,
  target: ArmyMember,
  profiles: Profiles,
  rules: Rules,
  crit = false,
  bypass = false
) => {
  let damage = profiles[attacker.kind].damage;
  if (attacker.kind === "cavalry" && ["shield", "heavy"].includes(target.kind)) damage *= 1.33;
  if (attacker.kind === "archer" && target.kind === "shield") damage *= 0.67;
  const armor = attacker.kind === "heavy" && bypass ? 0 : armorOf(target, profiles, rules);
  return damage * (1 - armor) * (crit ? 1.5 : 1);
};
/** Stationary circular silhouette proxy: central 80% radius is full, rim glancing.
 * Gaussian angular dispersion calibrates full contacts at eight cells; live mesh/terrain
 * projectile intersections and target motion are intentionally not implemented here. */
export const arrowContactProbabilities = (distance: number, rank: Rank) => {
  const fullReference = [0.7, 0.8, 0.9][rank - 1]!;
  const sigma = ((0.24 / Math.sqrt(-2 * Math.log(1 - fullReference))) * distance) / 8;
  if (sigma <= 1e-8) return { full: 1, glancing: 0, miss: 0 };
  const full = 1 - Math.exp(-(0.24 ** 2) / (2 * sigma ** 2));
  const any = 1 - Math.exp(-(0.3 ** 2) / (2 * sigma ** 2));
  return { full, glancing: any - full, miss: 1 - any };
};
export const sampleArrowContact = (distance: number, rank: Rank, sample: number) => {
  const contact = arrowContactProbabilities(distance, rank);
  if (sample < contact.full) return "full";
  if (sample < contact.full + contact.glancing) return "glancing";
  return "miss";
};
export const expectedDamage = (
  attacker: ArmyMember,
  target: ArmyMember,
  profiles: Profiles,
  rules = DEFAULT_RULES
) => {
  const contact =
    attacker.kind === "archer" && rules.archerAimError
      ? arrowContactProbabilities(profiles.archer.range, attacker.rank)
      : null;
  const hit =
    contact?.full ?? (attacker.kind === "archer" ? 1 - [0.3, 0.2, 0.1][attacker.rank - 1]! : 1);
  const crit = rules.critical ? [0, 0.05, 0.1][attacker.rank - 1]! : 0;
  let damage = landedDamage(attacker, target, profiles, rules);
  if (attacker.kind === "heavy")
    damage = damage * 0.67 + landedDamage(attacker, target, profiles, rules, false, true) * 0.33;
  let glancing = 0;
  if (contact) glancing = contact.glancing * 0.5;
  else if (attacker.kind === "archer" && rules.archerGlancing) glancing = (1 - hit) * 0.5;
  return damage * (hit * (1 + crit * 0.5) + glancing);
};
const createArmy = (
  army: readonly ArmyMember[],
  team: number,
  profiles: Profiles,
  rules: Rules
): Unit[] => {
  let front = 0,
    back = 0;
  return army.map((member) => {
    const archer = member.kind === "archer",
      index = archer ? back++ : front++;
    const row = Math.floor(index / rules.lanes),
      lane = index % rules.lanes;
    const hp = profiles[member.kind].hp * Math.pow(1.2, member.rank - 1);
    const rear = row * 0.85 + (archer && rules.distance > 1 ? rules.archerRearOffset : 0);
    return {
      ...member,
      team,
      hp,
      maxHp: hp,
      x: team === 0 ? -rules.distance / 2 - rear : rules.distance / 2 + rear,
      z: (lane - (rules.lanes - 1) / 2) * 0.85,
      anchorX: team === 0 ? -rules.distance / 2 - rear : rules.distance / 2 + rear,
      anchorZ: (lane - (rules.lanes - 1) / 2) * 0.85,
      retreating: false,
      backoffReady: 0,
      ready: 0
    };
  });
};
const nearestEnemy = (unit: Unit, enemies: readonly Unit[]) => {
  let target: Unit | undefined,
    range = Infinity;
  for (const enemy of enemies) {
    if (enemy.hp <= 0) continue;
    const current = distance(unit, enemy);
    if (current < range) {
      range = current;
      target = enemy;
    }
  }
  return target;
};
const advance = (
  unit: Unit,
  target: Unit,
  all: readonly Unit[],
  profiles: Profiles,
  rules: Rules
) => {
  const profile = profiles[unit.kind],
    range = profile.range * (unit.kind === "archer" ? rules.rangeMultiplier : 1);
  if (distance(unit, target) <= range) return;
  const speed = profile.speed * (unit.kind === "cavalry" ? rules.cavalrySpeedMultiplier : 1);
  const course = Math.atan2(target.z - unit.z, target.x - unit.x),
    reach = speed * rules.step;
  for (const offset of [0, 0.65, -0.65, 1.2, -1.2]) {
    const x = unit.x + Math.cos(course + offset) * reach,
      z = unit.z + Math.sin(course + offset) * reach;
    if (Math.abs(z) > (rules.lanes - 1) * 0.425 + 0.32) continue;
    if (
      unit.kind === "archer" &&
      rules.archerRetreat &&
      Math.hypot(x - unit.anchorX, z - unit.anchorZ) > rules.archerRetreatLimit
    )
      continue;
    if (
      all.some(
        (other) => other !== unit && other.hp > 0 && Math.hypot(x - other.x, z - other.z) < 0.6
      )
    )
      continue;
    unit.x = x;
    unit.z = z;
    return;
  }
};
const backoffArcher = (
  unit: Unit,
  target: Unit,
  all: readonly Unit[],
  profiles: Profiles,
  rules: Rules,
  seconds: number
) => {
  if (unit.kind !== "archer" || !rules.archerRetreat)
    return { handled: false, started: false, excursion: 0 };
  const gap = distance(unit, target);
  if (unit.retreating && gap >= rules.archerRetreatSeparation) unit.retreating = false;
  let started = false;
  if (!unit.retreating && gap < rules.archerMinRange && seconds >= unit.backoffReady) {
    unit.retreating = true;
    started = true;
  }
  if (!unit.retreating) return { handled: false, started, excursion: 0 };
  const course = Math.atan2(unit.z - target.z, unit.x - target.x),
    step = profiles.archer.speed * rules.step;
  for (const offset of [0, 0.65, -0.65, 1.2, -1.2]) {
    const x = unit.x + Math.cos(course + offset) * step,
      z = unit.z + Math.sin(course + offset) * step;
    if (
      Math.abs(z) > (rules.lanes - 1) * 0.425 + 0.32 ||
      Math.hypot(x - unit.anchorX, z - unit.anchorZ) > rules.archerRetreatLimit
    )
      continue;
    if (
      all.some(
        (other) => other !== unit && other.hp > 0 && Math.hypot(x - other.x, z - other.z) < 0.6
      )
    )
      continue;
    unit.x = x;
    unit.z = z;
    return { handled: true, started, excursion: Math.hypot(x - unit.anchorX, z - unit.anchorZ) };
  }
  unit.retreating = false;
  unit.backoffReady = seconds + 0.3;
  return {
    handled: true,
    started,
    excursion: Math.hypot(unit.x - unit.anchorX, unit.z - unit.anchorZ)
  };
};
const summary = (units: readonly Unit[]) => {
  const survivors: [number, number] = [0, 0],
    remaining: [number, number] = [0, 0];
  for (const unit of units)
    if (unit.hp > 0) {
      survivors[unit.team]!++;
      remaining[unit.team]! += unit.hp;
    }
  return { survivors, remaining };
};
/** Simultaneous damage batches avoid giving one side first-hit initiative. */
export const simulate = (
  left: readonly ArmyMember[],
  right: readonly ArmyMember[],
  profiles: Profiles,
  seed: number,
  overrides: Partial<Rules> = {}
): Outcome => {
  const rules = { ...DEFAULT_RULES, ...overrides },
    random = randomFor(seed);
  const teams = [createArmy(left, 0, profiles, rules), createArmy(right, 1, profiles, rules)];
  const units = teams.flat(),
    shots: Shot[] = [],
    attacks: [number, number] = [0, 0],
    damage: [number, number] = [0, 0];
  const emptyCounts = () => ({ shield: 0, heavy: 0, archer: 0, cavalry: 0 });
  const attacksByKind: Outcome["attacksByKind"] = [emptyCounts(), emptyCounts()];
  const livingSecondsByKind: Outcome["livingSecondsByKind"] = [emptyCounts(), emptyCounts()];
  const spent: [number, number] = [
    left.reduce((sum, u) => sum + profiles[u.kind].cost, 0),
    right.reduce((sum, u) => sum + profiles[u.kind].cost, 0)
  ];
  let seconds = 0;
  let archerMinReleaseDistance: number | null = null,
    archerBackoffStarts = 0,
    archerMaxBackoffExcursion = 0;
  for (; seconds < rules.limit; seconds += rules.step) {
    const state = summary(units);
    if (state.survivors.includes(0) && shots.length === 0) break;
    for (const unit of units)
      if (unit.hp > 0) livingSecondsByKind[unit.team]![unit.kind] += rules.step;
    // Alternate movement priority by seed and time step, keeping attack application simultaneous.
    const order = (seed + Math.round(seconds / rules.step)) % 2 ? units : [...units].reverse();
    for (const unit of order) {
      if (unit.hp <= 0) continue;
      const target = nearestEnemy(unit, teams[1 - unit.team]!);
      if (!target) continue;
      const backoff = backoffArcher(unit, target, units, profiles, rules, seconds);
      if (backoff.started) archerBackoffStarts++;
      archerMaxBackoffExcursion = Math.max(archerMaxBackoffExcursion, backoff.excursion);
      if (backoff.handled) continue;
      advance(unit, target, units, profiles, rules);
      const profile = profiles[unit.kind],
        range = profile.range * (unit.kind === "archer" ? rules.rangeMultiplier : 1);
      if (unit.ready > seconds + 1e-8 || distance(unit, target) > range) continue;
      if (unit.kind === "archer" && distance(unit, target) < rules.archerMinRange) continue;
      if (unit.kind === "archer")
        archerMinReleaseDistance = Math.min(
          archerMinReleaseDistance ?? Infinity,
          distance(unit, target)
        );
      attacks[unit.team]!++;
      attacksByKind[unit.team]![unit.kind]++;
      unit.ready = seconds + profile.interval;
      const contact =
        unit.kind === "archer" && rules.archerAimError
          ? sampleArrowContact(distance(unit, target), unit.rank, random())
          : null;
      const hit = contact
        ? contact === "full"
        : unit.kind !== "archer" || random() > [0.3, 0.2, 0.1][unit.rank - 1]!;
      if (contact === "miss" || (!contact && !hit && !rules.archerGlancing)) continue;
      const bypass = unit.kind === "heavy" && random() < 0.33;
      const crit = hit && rules.critical && random() < [0, 0.05, 0.1][unit.rank - 1]!;
      const amount = landedDamage(unit, target, profiles, rules, crit, bypass) * (hit ? 1 : 0.5);
      shots.push({
        at: seconds + (unit.kind === "archer" ? distance(unit, target) / 10 : 0),
        target,
        damage: amount
      });
    }
    const pending = new Map<Unit, number>();
    for (let i = shots.length - 1; i >= 0; i--) {
      const shot = shots[i]!;
      if (shot.at > seconds + 1e-8) continue;
      if (shot.target.hp > 0) {
        pending.set(shot.target, (pending.get(shot.target) ?? 0) + shot.damage);
        damage[1 - shot.target.team]! += shot.damage;
      }
      shots.splice(i, 1);
    }
    for (const [target, amount] of pending) target.hp -= amount;
  }
  const state = summary(units);
  let winner = -1;
  if (state.survivors[0] === 0) winner = 1;
  else if (state.survivors[1] === 0) winner = 0;
  return {
    attacksByKind,
    livingSecondsByKind,
    archerMinReleaseDistance,
    archerBackoffStarts,
    archerMaxBackoffExcursion,
    winner: state.survivors[0] === 0 && state.survivors[1] === 0 ? -1 : winner,
    seconds,
    ...state,
    spent,
    attacks,
    damage
  };
};
