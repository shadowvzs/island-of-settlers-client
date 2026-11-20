import { requireBuildingGeometry } from "@shared/catalog/building-data/geometry";

import { CATAPULT_ENGINE_ORIGIN, CATAPULT_STONE_DIAMETER } from "../../render-common/buildings/catapult-mechanism";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { createRandom } from "../world/rng";
import {
  catapultAmmoChoice, type CatapultAmmoKind, catapultAmmoProfile, DEFAULT_CATAPULT_AMMO
} from "./catapult-ammo-kinds";
import {
  CATAPULT_ANCHORS, CATAPULT_HOME_YAW, CATAPULT_PHASE_SECONDS, CATAPULT_PREPARE_SECONDS, type CatapultPhase, catapultPhaseDuration
} from "./catapult-cycle";
import {
  CATAPULT_AMMO_CAPACITY, catapultNextRackKind, catapultReservedKind, catapultRoofStone, loadReservedStone,
  releaseReservedStone, reserveRackStone, retrieveReservedStone
} from "./military-catapult-ammo";
import { CATAPULT_IMPACT_RADIUS } from "./military-catapult-impact";
import { updateCatapultRecovery } from "./military-catapult-recovery";
import { catapultGroundStone, catapultRoofReserved } from "./military-catapult-resupply";
import { startCatapultRoll } from "./military-catapult-roll";
import { ARROW_GRAVITY, type MilitaryArrow } from "./military-projectiles";
import type { SettlementSoldier } from "./settlement-military";
import { ownerOf } from "./settlement-ownership";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

export { CATAPULT_PHASE_SECONDS } from "./catapult-cycle";

/** Owner decision 2026-11-06: a round ten-tile base range for the Catapult Tower. */
export const CATAPULT_BASE_RANGE = 10;
export const CATAPULT = Object.freeze({ aimSpeed: 1.4, capacity: CATAPULT_AMMO_CAPACITY, flight: 1.5, minimumRange: 1, radius: CATAPULT_IMPACT_RADIUS, range: CATAPULT_BASE_RANGE, reload: 5 });
type Enemy = SettlementActor & { soldier: SettlementSoldier };

/** Aiming requires a visible target; the actual boulder arcs over intervening terrain. */
const visibleTarget = (context: SettlementContext, building: SettlementBuilding, enemy: SettlementActor) => {
  const distance = DMath.hypot(enemy.x - building.x, enemy.z - building.z);
  const steps = Math.ceil(distance * 4);
  const eye = building.y + CATAPULT_ANCHORS.operator[1] *
    requireBuildingGeometry(16).plot.scale + .9;
  for (let index = 1; index < steps; index++) {
    const t = index / steps, x = building.x + (enemy.x - building.x) * t;
    const z = building.z + (enemy.z - building.z) * t;
    const y = eye + (enemy.y + .6 - eye) * t;
    if (sampleSmooth(context.options.world, context.options.world.heights, x, z) > y) return false;
    if (context.buildings.some(other => other.uid !== building.uid && other.construction === 1 &&
      Math.abs(x - other.x) < other.width / 2 && Math.abs(z - other.z) < other.depth / 2 && y < other.y + 1.4)) return false;
  }
  return true;
};

export const catapultEnemyAtEdge = (building: SettlementBuilding, enemies: readonly Enemy[]) =>
  enemies.some(enemy => Math.abs(enemy.x - building.x) <= building.width / 2 + .25 &&
    Math.abs(enemy.z - building.z) <= building.depth / 2 + .25);

const catapultTargetKind = (building: SettlementBuilding) =>
  catapultReservedKind(building.catapultCycle) ?? catapultNextRackKind(building) ?? catapultAmmoChoice(building);

export const catapultTarget = (building: SettlementBuilding, enemies: readonly Enemy[],
  visible: (enemy: Enemy) => boolean) => {
  const range = CATAPULT.range * catapultAmmoProfile(catapultTargetKind(building)).range;
  let target: Enemy | undefined, nearest = Infinity;
  for (const enemy of enemies) {
    const distance = DMath.hypot(enemy.x - building.x, enemy.z - building.z);
    if (distance < CATAPULT.minimumRange || distance > range || distance >= nearest || !visible(enemy)) continue;
    target = enemy; nearest = distance;
  }
  return target;
};

export type CatapultStatus = "no-heavy" | "defending" | "no-porter" | "no-stone" | "restocking" | "supply-unsafe" | "supply-blocked" | "reloading" | "ready";
export const catapultStatus = (building: SettlementBuilding, soldiers: readonly SettlementSoldier[],
  actors: readonly SettlementActor[]): CatapultStatus => {
  const heavy = soldiers.find(soldier => soldier.building === building.uid &&
    soldier.commanderId === undefined && soldier.combat?.type === "heavy" && soldier.combat.hp > 0);
  if (!heavy) return "no-heavy";
  if (!heavy.stationed) return "defending";
  const faction = ownerOf(building);
  if (actors.some(actor => {
    const soldier = soldiers.find(candidate => candidate.actor === actor.uid);
    return actor.visible && soldier?.combat && soldier.combat.faction !== faction &&
      Math.abs(actor.x - building.x) <= building.width / 2 + .25 &&
      Math.abs(actor.z - building.z) <= building.depth / 2 + .25;
  })) return "defending";
  if (catapultRoofStone(building) < 1 && catapultGroundStone(building) > 0) {
    if (!actors.some(actor => actor.uid === building.worker && actor.job === "Carrier")) return "no-porter";
    if (building.catapultSupply?.paused === "threat") return "supply-unsafe";
    if (building.catapultSupply?.paused === "blocked") return "supply-blocked";
    return "restocking";
  }
  if (catapultRoofStone(building) < 1) return "no-stone";
  if (building.catapultCycle?.phase === "ready" && building.catapultCycle.ammo === "cup") return "ready";
  if ((building.catapultReload ?? 0) > 0 || building.catapultCycle) return "reloading";
  return "ready";
};

/** Flight seconds of a released shot; its kind fixes the value for the whole flight. */
export const catapultBoulderFlight = (kind: CatapultAmmoKind | undefined) =>
  CATAPULT.flight * catapultAmmoProfile(kind).flightTime;
const releaseBoulder = (building: SettlementBuilding, heavy: SettlementSoldier, target: Enemy,
  release: (arrow: Omit<MilitaryArrow, "id">) => void, random?: () => number) => {
  const kind = catapultReservedKind(building.catapultCycle) ?? DEFAULT_CATAPULT_AMMO;
  if (!releaseReservedStone(building)) return false;
  const flight = catapultBoulderFlight(kind), roll = random ?? createRandom(building.uid * 7919 + target.uid);
  building.catapultReload = CATAPULT.reload;
  const scale = requireBuildingGeometry(16).plot.scale;
  const base = building.rotation * Math.PI / 2, aim = building.catapultAim ?? CATAPULT_HOME_YAW;
  const [rx, ry, rz] = CATAPULT_ANCHORS.release;
  const localX = CATAPULT_ENGINE_ORIGIN[0] + DMath.cos(aim) * (rx - CATAPULT_ENGINE_ORIGIN[0]) + DMath.sin(aim) * (rz - CATAPULT_ENGINE_ORIGIN[2]);
  const localZ = CATAPULT_ENGINE_ORIGIN[2] + DMath.cos(aim) * (rz - CATAPULT_ENGINE_ORIGIN[2]) - DMath.sin(aim) * (rx - CATAPULT_ENGINE_ORIGIN[0]);
  const x = building.x + (DMath.cos(base) * localX + DMath.sin(base) * localZ) * scale;
  const z = building.z + (DMath.cos(base) * localZ - DMath.sin(base) * localX) * scale;
  const y = building.y + ry * scale;
  const shotBase = { age: 0, building: building.uid, faction: ownerOf(building),
    rank: heavy.rank, shooter: heavy.actor, x, y, z,
    vx: (target.x - x) / flight, vz: (target.z - z) / flight,
    vy: (target.y - y + .5 * ARROW_GRAVITY * flight * flight) / flight };
  const diameter = CATAPULT_STONE_DIAMETER * scale;
  if (kind === "granite") {
    for (let fragment = 0; fragment < 5; fragment += 1) {
      const angle = roll() * Math.PI * 2, distance = 1.5 + roll() * .75;
      const fx = target.x + DMath.cos(angle) * distance, fz = target.z + DMath.sin(angle) * distance;
      release({ ...shotBase, boulder: { diameter: diameter * .55, fragment: true, kind,
        target: target.uid, x: fx, y: target.y, z: fz } });
    }
    return true;
  }
  release({ ...shotBase, boulder: { diameter, ...(kind === DEFAULT_CATAPULT_AMMO ? {} : { kind }),
    target: target.uid, x: target.x, y: target.y, z: target.z } });
  return true;
};
const targetYaw = (building: SettlementBuilding, target: Enemy) => {
  const scale = requireBuildingGeometry(16).plot.scale, base = building.rotation * Math.PI / 2;
  const x = building.x + (DMath.cos(base) * CATAPULT_ENGINE_ORIGIN[0] + DMath.sin(base) * CATAPULT_ENGINE_ORIGIN[2]) * scale;
  const z = building.z + (DMath.cos(base) * CATAPULT_ENGINE_ORIGIN[2] - DMath.sin(base) * CATAPULT_ENGINE_ORIGIN[0]) * scale;
  return DMath.atan2(target.x - x, target.z - z) + Math.PI - base;
};
const angleDifference = (building: SettlementBuilding, desired: number) =>
  DMath.atan2(DMath.sin(desired - (building.catapultAim ?? CATAPULT_HOME_YAW)),
    DMath.cos(desired - (building.catapultAim ?? CATAPULT_HOME_YAW)));
/** No hand on the traverse bar means no angular movement. */
const turnByHand = (building: SettlementBuilding, desired: number, dt: number) => {
  const difference = angleDifference(building, desired), maximum = dt * CATAPULT.aimSpeed;
  const step = Math.max(-maximum, Math.min(maximum, difference));
  const angle = (building.catapultAim ?? CATAPULT_HOME_YAW) + step;
  building.catapultAim = DMath.atan2(DMath.sin(angle), DMath.cos(angle));
  building.catapultCycle!.turnVelocity = dt > 0 ? step / dt : 0;
};
const PHASES: readonly CatapultPhase[] = ["pick", "load", "clear", "traverse", "fire", "return", "park"];
const advanceCatapultCycle = (building: SettlementBuilding, heavy: SettlementSoldier, target: Enemy | undefined,
  dt: number, release: (arrow: Omit<MilitaryArrow, "id">) => void, random?: () => number) => {
  const cycle = building.catapultCycle!;
  if (cycle.phase === "wind") { cycle.phase = "clear"; cycle.elapsed = 0; }
  if (cycle.phase === "park") {
    cycle.elapsed += dt; turnByHand(building, CATAPULT_HOME_YAW, dt);
    if (Math.abs(angleDifference(building, CATAPULT_HOME_YAW)) < .002) {
      if (cycle.ammo === "cup") { cycle.phase = "ready"; cycle.elapsed = 0; cycle.armHold = 1.25; }
      else building.catapultCycle = undefined;
    }
    return;
  }
  if (cycle.phase === "recover-cup" || cycle.phase === "rewind" || cycle.phase === "retrieve" || cycle.phase === "empty-return") {
    cycle.turnVelocity = 0; cycle.elapsed += dt;
    if (cycle.elapsed + 1e-9 < catapultPhaseDuration(cycle)) return;
    if (cycle.phase === "empty-return") { building.catapultCycle = undefined; return; }
    if (cycle.phase === "retrieve") {
      if (!retrieveReservedStone(building)) { building.catapultCycle = undefined; return; }
      cycle.phase = "load"; cycle.elapsed = 0; return;
    }
    if (cycle.phase === "recover-cup") { cycle.phase = "rewind"; cycle.elapsed = 0; return; }
    cycle.armHold = 1.25; cycle.elapsed = 0;
    if (target && !catapultRoofReserved(building)) { cycle.target = target.uid; cycle.phase = "traverse"; }
    else cycle.phase = "park";
    return;
  }
  if (cycle.phase === "traverse") {
    cycle.elapsed += dt;
    if (!target) { building.catapultCycle = undefined; return; }
    turnByHand(building, targetYaw(building, target), dt);
    if (Math.abs(angleDifference(building, targetYaw(building, target))) < .002) { cycle.phase = "fire"; cycle.elapsed = 0; }
    return;
  }
  if (cycle.phase === "fire" && target) turnByHand(building, targetYaw(building, target), dt);
  else cycle.turnVelocity = 0;
  if (cycle.phase === "pick" && !cycle.ammo && cycle.elapsed + dt >= CATAPULT_PHASE_SECONDS.pick * .6 && !reserveRackStone(building)) {
    building.catapultCycle = undefined; return;
  }
  cycle.elapsed += dt;
  while (catapultPhaseDuration(cycle) > 0 && cycle.elapsed + 1e-9 >= catapultPhaseDuration(cycle)) {
    if (cycle.phase === "load" && !loadReservedStone(building)) { building.catapultCycle = undefined; return; }
    const spent = catapultPhaseDuration(cycle);
    if (cycle.phase === "clear" && !target) { cycle.phase = "ready"; cycle.elapsed = 0; cycle.armHold = 1.25; return; }

    if (cycle.phase === "fire") {
      if (!target || catapultRoofStone(building) < 1) { building.catapultCycle = undefined; return; }
      if ((building.catapultReload ?? 0) > 1e-9 || Math.abs(angleDifference(building, targetYaw(building, target))) > .002) {
        cycle.elapsed = CATAPULT_PHASE_SECONDS.fire; return;
      }
      if (!releaseBoulder(building, heavy, target, release, random)) { building.catapultCycle = undefined; return; }
    }
    cycle.elapsed = Math.max(0, cycle.elapsed - spent);
    cycle.phase = PHASES[PHASES.indexOf(cycle.phase) + 1]!;
    if (cycle.phase === "park" || cycle.phase === "traverse") { cycle.elapsed = 0; return; }
  }
};

/** Saved hand-driven traverse, fixed-floor handling and independent minimum reload. */
export const fireCatapultTowers = (context: SettlementContext, soldiers: ReadonlyMap<number, SettlementSoldier>,
  field: readonly SettlementActor[], dt: number, release: (arrow: Omit<MilitaryArrow, "id">) => void,
  isBuildingStanding: (uid: number) => boolean = () => true, random?: () => number) => {
  for (const building of context.buildings) {
    if (building.typeId !== 16 || building.construction !== 1) continue;
    if (!isBuildingStanding(building.uid)) { building.catapultCycle = undefined; continue; }
    building.catapultReload = Math.max(0, (building.catapultReload ?? 0) - dt);
    const faction = ownerOf(building);
    const heavy = [...soldiers.values()].find(soldier => soldier.building === building.uid && soldier.stationed &&
      soldier.commanderId === undefined && soldier.combat?.type === "heavy" && soldier.combat.hp > 0);
    const enemies = field.flatMap(body => {
      const soldier = soldiers.get(body.uid);
      return soldier?.combat && soldier.combat.faction !== faction && soldier.combat.hp > 0 ? [{ ...body, soldier }] : [];
    });
    const legacy = building.catapultCycle;
    if (legacy && !legacy.ammo && ["load", "wind", "clear", "traverse", "fire"].includes(legacy.phase)) {
      if (reserveRackStone(building) && legacy.phase !== "load") loadReservedStone(building);
    }
    const safeHeavy = catapultEnemyAtEdge(building, enemies) ? undefined : heavy;
    const phase = building.catapultCycle?.phase;
    const returning = phase === "return" || phase === "park" || phase === "empty-return";
    const chooseNew = phase === "ready" || phase === "rewind" || phase === "recover-cup";
    const candidates = building.catapultCycle && !chooseNew ? enemies.filter(enemy => enemy.uid === building.catapultCycle!.target) : enemies;
    const target = catapultTarget(building, candidates, enemy => visibleTarget(context, building, enemy));
    if (updateCatapultRecovery(context, building, safeHeavy, target, dt)) continue;
    if (!safeHeavy) { building.catapultCycle = undefined; continue; }
    if (!building.catapultCycle) {
      if (Math.abs(angleDifference(building, CATAPULT_HOME_YAW)) > .002) {
        building.catapultCycle = { elapsed: 0, operator: safeHeavy.actor, phase: "park", target: target?.uid ?? safeHeavy.actor };
      } else {
        const roof = catapultRoofStone(building);
        if (catapultRoofReserved(building) || !target || roof < 1 ||
          building.catapultReload > CATAPULT_PREPARE_SECONDS) continue;
        building.catapultCycle = { elapsed: 0, operator: safeHeavy.actor, phase: "pick",
          stoneSlot: Math.max(0, Math.min(CATAPULT.capacity, roof) - 1), target: target.uid };
      }
    } else if (!returning && !building.catapultCycle.ammo && (!target || catapultRoofStone(building) < 1)) {
      building.catapultCycle = undefined; continue;
    }
    // Older preparation saves cannot leave the crew loading a launcher at an unrelated bearing.
    if (["pick", "load", "wind", "clear"].includes(building.catapultCycle.phase) &&
      Math.abs(angleDifference(building, CATAPULT_HOME_YAW)) > .002) {
      building.catapultCycle.phase = "park"; building.catapultCycle.elapsed = 0;
    }
    advanceCatapultCycle(building, safeHeavy, target, dt, release, random);
  }
};

/** Advance non-homing flight to its fixed impact point. Enemy area damage resolves at the impact boundary. */
export const sweepCatapultBoulder = (arrow: MilitaryArrow, dt: number) => {
  const aim = arrow.boulder!, flight = catapultBoulderFlight(aim.kind);
  if (aim.restAge !== undefined) {
    aim.restAge += dt;
    return aim.restAge >= 4.5
      ? { stopped: false, removed: true, target: undefined }
      : { stopped: false, removed: false, target: undefined };
  }
  const step = Math.min(dt, flight - arrow.age);
  arrow.x += arrow.vx * step; arrow.z += arrow.vz * step;
  arrow.y += arrow.vy * step - .5 * ARROW_GRAVITY * step * step;
  arrow.vy -= ARROW_GRAVITY * step; arrow.age += step;
  if (arrow.age < flight) return { stopped: false, removed: false, target: undefined };
  arrow.x = aim.x; arrow.y = aim.y; arrow.z = aim.z;
  if (aim.kind === "marble") startCatapultRoll(arrow);
  else aim.restAge = 0;
  return { stopped: true, removed: false, target: undefined, full: true };
};
