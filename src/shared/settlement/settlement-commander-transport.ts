import { isNation } from "../../../../island-of-settlers-shared/src/nations";
import { isFiniteNumber } from "../../../../island-of-settlers-shared/src/validation/guards";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { DMath } from "../math/deterministic-math";
import { type CommanderOperationId, isCommanderOperationId } from "./commander-operation-id";
import { militaryGroundPath } from "./military-routing";
import {
  COMMANDER_RECOVERY_SECONDS, COMMANDER_XP_THRESHOLDS, commanderLevelForXp,
  commanderMaximumHealth, commanderNextThreshold, commanderRecruitCatalog,
type CommanderState} from "./settlement-commander";
import { isMountedNavigationClear } from "./settlement-navigation";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * Commander transport rules (COM-03..05,07). The manifest is the one receipt carried through an
 * outward/return voyage: identity, fixed definition, XP/level, real HP and the failure marker.
 * Worker-safe: no live simulation state, no rendering.
 */
export const COMMANDER_DECK_SLOTS = 2;
/** The commander counts as one unit toward the expedition troop cap. */
export const COMMANDER_TROOP_CAP_UNITS = 1;
/** Phases where the commander is physically between the lodge and a ship. */
export const COMMANDER_MUSTER_PHASE = "commanderMuster";
export const COMMANDER_WAITING_PHASE = "commanderWaiting";
export const COMMANDER_BOARDING_PHASE = "commanderBoarding";
export const COMMANDER_RETURNING_PHASE = "commanderReturning";
export const COMMANDER_LANDING_PHASE = "commanderLanding";

/** One transport receipt: the single authoritative copy of the commander while away from home. */
export interface CommanderManifest {
  id: string;
  name: string;
  nation: WorkerNation;
  definitionId?: string;
  xp: number;
  level: 1 | 2 | 3;
  /** Real current HP, never a multiplier or a rounded percentage. */
  hp: number;
  maximumHp: number;
  recoverySeconds: number;
  healingSeconds: number;
  /** The operation this commander is deployed with; positive and unique per source island. */
  operationId: CommanderOperationId;
  destinationName: string;
  homeIslandSeed: number;
  /** Zero-HP casualty awaiting evacuation: arrival stabilizes once at 1 HP. */
  casualty: boolean;
  /** A failed participating mission: the 30-minute recovery starts at home arrival. */
  failureId?: string;
  lastXpResult?: string;
  phase: "outward" | "returning";
}

const boundedText = (value: unknown, maximum = 160): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maximum;

/** The manifest must be internally consistent before a destination world adopts it. */
export const commanderManifestError = (value: unknown): string | null => {
  if (!value || typeof value !== "object") return "Invalid commander manifest";
  const manifest = value as CommanderManifest;
  if (!boundedText(manifest.id, 120) || !boundedText(manifest.name, 120) || !isNation(manifest.nation))
    return "Invalid commander manifest identity";
  if (manifest.definitionId !== undefined && !commanderRecruitCatalog(manifest.nation)
    .some(definition => definition.id === manifest.definitionId)) return "Invalid commander definition";
  if (!Number.isSafeInteger(manifest.xp) || manifest.xp < 0 || manifest.xp > COMMANDER_XP_THRESHOLDS[2]!)
    return "Invalid commander manifest experience";
  if (!Number.isSafeInteger(manifest.level) || manifest.level < 1 || manifest.level > 3 ||
    manifest.level !== commanderLevelForXp(manifest.xp)) return "Invalid commander manifest level";
  if (!isFiniteNumber(manifest.hp) || manifest.hp < 0 || !isFiniteNumber(manifest.maximumHp) ||
    manifest.maximumHp !== commanderMaximumHealth(manifest.level) || manifest.hp > manifest.maximumHp + 1e-6)
    return "Invalid commander manifest health";
  if (!isFiniteNumber(manifest.recoverySeconds) || manifest.recoverySeconds < 0 ||
    manifest.recoverySeconds > COMMANDER_RECOVERY_SECONDS ||
    !isFiniteNumber(manifest.healingSeconds) || manifest.healingSeconds < 0 || manifest.healingSeconds >= 60)
    return "Invalid commander manifest recovery";
  if (!isCommanderOperationId(manifest.operationId) ||
    !boundedText(manifest.destinationName, 80) || !Number.isSafeInteger(manifest.homeIslandSeed) ||
    manifest.homeIslandSeed < 0 || typeof manifest.casualty !== "boolean" ||
    !["outward", "returning"].includes(manifest.phase) ||
    (manifest.failureId !== undefined && !boundedText(manifest.failureId)) ||
    (manifest.lastXpResult !== undefined && !boundedText(manifest.lastXpResult))) return "Invalid commander manifest transport";
  if (manifest.casualty && manifest.hp !== 0) return "An evacuated casualty has zero HP";
  return null;
};

export const copyCommanderManifest = (manifest: CommanderManifest): CommanderManifest => ({ ...manifest });

/** The visible/transport-location fields the lodge and planner cards read. */
export const commanderTransportReason = (state: CommanderState): string | null => {
  const phase = state.transport?.phase;
  if (phase === "reserved") return "Commander assigned to an expedition";
  if (phase === "muster" || phase === "waiting") return "Commander mustering at the harbour";
  if (phase === "aboard") return "Commander aboard an expedition ship";
  if (phase === "deployed") return "Commander deployed abroad";
  if (phase === "returning") return "Commander returning home";
  if (phase === "awaiting-evacuation") return "Commander awaiting evacuation";
  return null;
};

/** An incapacitated commander is a durable casualty record, never a dead lobby unit. */
export const commanderCasualty = (state: CommanderState, hp: number) =>
  state.location === "incapacitated" || hp <= 0;

export const commanderManifestFromState = (
  state: CommanderState, hp: number, recoverySeconds = state.recoverySeconds,
  phase: CommanderManifest["phase"] = "outward"
): CommanderManifest => ({
  casualty: hp <= 0,
  destinationName: state.transport?.destinationName ?? "Expedition",
  failureId: state.failureId,
  healingSeconds: state.healingSeconds,
  homeIslandSeed: state.homeIslandSeed ?? 0,
  hp: Math.max(0, hp),
  id: state.id,
  lastXpResult: state.lastXpResult,
  level: state.level,
  maximumHp: commanderMaximumHealth(state.level),
  name: state.name,
  nation: state.nation,
  definitionId: state.definitionId,
  operationId: state.transport?.operationId ?? state.operationId ?? 1,
  phase,
  recoverySeconds,
  xp: state.xp
});

/** The state a destination island or the home roster derives from one manifest. */
export const commanderStateFromManifest = (
  manifest: CommanderManifest, homeLodgeUid: number, location: CommanderState["location"]
): CommanderState => ({
  ...(manifest.failureId ? { failureId: manifest.failureId } : {}),
  ...(manifest.lastXpResult ? { lastXpResult: manifest.lastXpResult } : {}),
  destinationName: manifest.destinationName,
  healingSeconds: manifest.healingSeconds,
  homeIslandSeed: manifest.homeIslandSeed,
  homeLodgeUid,
  id: manifest.id,
  level: manifest.level,
  location,
  name: manifest.name,
  nation: manifest.nation,
  definitionId: manifest.definitionId,
  operationId: manifest.operationId,
  recoverySeconds: manifest.recoverySeconds,
  transport: { destinationName: manifest.destinationName, operationId: manifest.operationId, phase: "deployed" },
  xp: manifest.xp
});

/** A filed save's commander becomes a manifest when its colony/adventure ends. */
export const savedCommanderManifest = (
  state: CommanderState, hp: number, operationId: CommanderOperationId, destinationName: string
): CommanderManifest => ({
  casualty: hp <= 0,
  destinationName,
  failureId: state.failureId,
  healingSeconds: state.healingSeconds,
  homeIslandSeed: state.homeIslandSeed ?? 0,
  hp: Math.max(0, hp),
  id: state.id,
  lastXpResult: state.lastXpResult,
  level: state.level,
  maximumHp: commanderMaximumHealth(state.level),
  name: state.name,
  nation: state.nation,
  definitionId: state.definitionId,
  operationId,
  phase: "returning",
  recoverySeconds: state.recoverySeconds,
  xp: state.xp
});

export const commanderManifestNextThreshold = (manifest: CommanderManifest) =>
  commanderNextThreshold(manifest.level);

export const commanderManifestReady = (manifest: CommanderManifest) =>
  !manifest.casualty && manifest.hp > 0 && manifest.hp >= manifest.maximumHp * .5 &&
  manifest.recoverySeconds <= 0;

const OPEN_SIDES = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const isOpenMountedGround = (context: SettlementContext, point: SettlementPoint) =>
  OPEN_SIDES.every(([dx, dz]) => isMountedNavigationClear(context,
    { x: point.x + dx * 1.3, z: point.z + dz * 1.3 }));

const clearOfBuildings = (context: SettlementContext, point: SettlementPoint) =>
  context.buildings.every(building => DMath.hypot(point.x - building.x, point.z - building.z) >
    Math.max(building.width, building.depth) / 2 + 1.2);

/** Clear of the civilian door lane, mounted-safe all round. */
const clearOfDoorLane = (harbour: SettlementBuilding, point: SettlementPoint) =>
  DMath.hypot(point.x - harbour.workerApproach.x, point.z - harbour.workerApproach.z) > 2.2 &&
  DMath.hypot(point.x - harbour.doorThreshold.x, point.z - harbour.doorThreshold.z) > 2.6;

/**
 * A safe off-road waiting place outside the harbour: mounted clearance all round, away from the
 * civilian door lane, with a real mounted route from the lodge.
 */
export const commanderHarbourMusterPoint = (
  context: SettlementContext, harbour: SettlementBuilding
): SettlementPoint | null => {
  const { access } = harbour;
  const candidates: SettlementPoint[] = [];
  for (let ring = 2; ring <= 7; ring += 1)
    for (let step = 0; step < 16; step++) {
      const angle = step / 16 * Math.PI * 2;
      candidates.push({ x: access.x + DMath.cos(angle) * ring, z: access.z + DMath.sin(angle) * ring });
    }
  return candidates.find(point => {
    const cell = Math.floor(point.z) * context.options.world.cellsX + Math.floor(point.x);
    return isOpenMountedGround(context, point) && !context.occupied[cell] &&
      clearOfBuildings(context, point) && clearOfDoorLane(harbour, point);
  }) ?? null;
};

export interface CommanderMusterPlan {
  kind: "harbour" | "landing";
  point: SettlementPoint;
  path: SettlementPoint[];
  /** Mounted-clear ground just outside the lodge; the lodge door is walked first. */
  start: SettlementPoint;
}

const openRingPoint = (context: SettlementContext, origin: SettlementPoint, minimum = 2): SettlementPoint | null => {
  const world = context.options.world;
  for (let ring = minimum; ring <= 7; ring += 1)
    for (let step = 0; step < 16; step++) {
      const angle = step / 16 * Math.PI * 2;
      const point = { x: origin.x + DMath.cos(angle) * ring, z: origin.z + DMath.sin(angle) * ring };
      const cell = Math.floor(point.z) * world.cellsX + Math.floor(point.x);
      if (!isOpenMountedGround(context, point) || context.occupied[cell]) continue;
      if (!clearOfBuildings(context, point)) continue;
      return point;
    }
  return null;
};

/**
 * Plans the real exterior route: lodge access → open ground → an off-road muster point at the
 * harbour (or the adventure landing clearing). A blocked route is refused, never teleported.
 */
export const planCommanderMuster = (
  context: SettlementContext, lodge: SettlementBuilding | undefined, harbour: SettlementBuilding | undefined
): { plan: CommanderMusterPlan } | { reason: string } => {
  if (!lodge) return { reason: "No reachable friendly Commander's Lodge is available" };
  if (!harbour) return { reason: "No reachable harbour is available for this expedition" };
  const point = commanderHarbourMusterPoint(context, harbour);
  if (!point) return { reason: "No safe exterior muster point beside this harbour" };
  const start = isOpenMountedGround(context, lodge.access) && clearOfBuildings(context, lodge.access)
    ? lodge.access : openRingPoint(context, lodge.access, 1);
  if (!start) return { reason: "No mounted-safe ground outside the Commander's Lodge" };
  const path = militaryRoute(context, start, point);
  if (!path) return { reason: "No mounted-safe ground route from the Commander's Lodge to the harbour" };
  return { plan: { kind: "harbour", path, point, start } };
};

/** A mounted-safe route from a building's exterior access to a point. */
export const militaryRoute = (
  context: SettlementContext, from: SettlementPoint, point: SettlementPoint
): SettlementPoint[] | null => {
  const path = militaryGroundPath(context, from, point, true);
  return path?.length ? path : null;
};

/** A mounted-safe route for an actor already standing outside (field return). */
export const militaryActorRoute = (
  context: SettlementContext, actor: SettlementActor, point: SettlementPoint, mounted = true
): SettlementPoint[] | null => {
  const path = militaryGroundPath(context, actor, point, mounted);
  return path?.length ? path : null;
};
