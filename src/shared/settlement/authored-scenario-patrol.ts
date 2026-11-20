import type { MapScenario, ScenarioUnit } from "../world/map-scenario";
import type { createSettlementMilitary } from "./settlement-military";
import type { SettlementContext } from "./settlement-types";

const unitIndexes = new WeakMap<MapScenario, { list: ScenarioUnit[]; count: number; byId: Map<number, ScenarioUnit> }>();
const patrolUnits = (definition: MapScenario) => {
  const cached = unitIndexes.get(definition);
  if (cached?.list === definition.units && cached.count === definition.units.length) return cached.byId;
  const byId = new Map(definition.units.map(unit => [unit.id, unit]));
  unitIndexes.set(definition, { list: definition.units, count: definition.units.length, byId });
  return byId;
};
export const validAuthoredPatrolProgress = (value: unknown, definition?: MapScenario) => {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 256 || !definition || definition.kind === "home") return false;
  const actors = new Set<number>(), units = new Set<number>();
  return value.every(row => {
    if (!row || typeof row !== "object" || !Number.isSafeInteger(row.actor) || row.actor < 0 ||
      !Number.isSafeInteger(row.unit) || actors.has(row.actor) || units.has(row.unit)) return false;
    const unit = definition.units.find(unit => unit.id === row.unit);
    if (!unit?.patrol?.length || !Number.isSafeInteger(row.next) || row.next < 0 || row.next > unit.patrol.length ||
      !Number.isFinite(row.wait) || row.wait < 0 || row.wait > 1) return false;
    actors.add(row.actor); units.add(row.unit); return true;
  });
};

/** Fixed-step saved state; one navigation request per tick, no timers or actor-map rebuilds. */
export const updateAuthoredPatrols = (
  context: SettlementContext, dt: number, combat: ReturnType<typeof createSettlementMilitary>["combat"]
) => {
  const definition = context.options.world.scenario, progress = context.authoredScenario;
  if (!definition || definition.kind === "home" || context.options.scenarioDraft || progress?.status !== "active" ||
    !progress.patrols?.length) return;
  const units = patrolUnits(definition);
  for (const patrol of progress.patrols) patrol.wait = Math.max(0, patrol.wait - dt);
  for (const patrol of progress.patrols) {
    if (patrol.wait > 0) continue;
    const unit = units.get(patrol.unit);
    if (!unit?.patrol?.length) continue;
    const point = patrol.next === 0 ? unit : unit.patrol[patrol.next - 1];
    if (!point) continue;
    const result = combat.patrolOpponent(patrol.actor, point, unit.faction);
    if (result === "arrived") {
      patrol.next = (patrol.next + 1) % (unit.patrol.length + 1); patrol.wait = .5;
    } else if (result === "ordered" || result === "blocked") {
      patrol.wait = result === "blocked" ? 1 : .25;
      return;
    }
  }
};
