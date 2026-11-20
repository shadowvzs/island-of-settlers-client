import {
  type BuildingLimits, type BuildingMechanismKey, type BuildingStyleKey, catalogEntries, settlerJob
} from "@shared/catalog";
import { requireBuildingGeometry } from "@shared/catalog/building-data/geometry";
import { buildingsWithRules } from "@shared/catalog/building-data/rules";

/** Stable local building identifiers; original designs, no third-party artwork. */
export type BuildingMechanism = BuildingMechanismKey;
export type BuildingStyle = BuildingStyleKey;
export interface BuildingDefinition {
  id: number;
  name: string;
  role: string;
  worker: string;
  task: string;
  style: BuildingStyle;
  footprint: 1 | 2 | 3;
  gridFootprint: readonly [number, number];
  garrisonCapacity?: number;
  roof: string;
  mechanism: BuildingMechanism;
  props: string[];
  extension: boolean;
  /** Shared capacity across output types; supplies and equipment do not count. */
  outputStorage?: { capacity: number; goods: readonly string[] };
  /** Optional placement/count policy; `max` counts every site, including construction. */
  /**
   * `max` counts the player's own buildings and sites; `homeOnly` types are home-island buildings, and
   * `commanderCampaign` also allows one on a campaign map whose scenario allows the commander (R11).
   */
  buildLimit?: { commanderCampaign?: boolean; homeOnly?: boolean; max?: number };
}
/** Removed IDs are reserved; unsupported saves are rejected before restore. */
export const RETIRED_BUILDING_IDS: ReadonlySet<number> = new Set(catalogEntries()
  .filter(entry => entry.kind === "building" && entry.retired).map(entry => entry.code!));

/** The sim's placement/count policy: the catalog limits without the colony rule (colony-island-rules.ts). */
const buildLimitOf = (limits: BuildingLimits = {}): BuildingDefinition["buildLimit"] => {
  const { colony: _colony, ...limit } = limits;
  return Object.keys(limit).length ? limit : undefined;
};

/**
 * Every active building in ascending code order: a view of the content catalog entry (`building:*`) and its rules
 * sidecar (`data/buildings/<key>/rules.json`).
 */
export const BUILDING_CATALOG: readonly BuildingDefinition[] = buildingsWithRules().map(({ entry, rules }) => {
  const { art, limits, military, output, production } = rules;
  return {
    id: entry.code,
    /** English name: the content catalog's (`building:*` `text.name.en`). */
    name: entry.text.name.en,
    role: rules.role.en,
    worker: rules.worker ? settlerJob(rules.worker) : "None",
    task: rules.task,
    style: art.style,
    footprint: art.footprint,
    /** Reserved plot from the geometry sidecar (`npm run building-geometry`), never a recipe evaluation. */
    get gridFootprint(): readonly [number, number] { return requireBuildingGeometry(this.id).plot.cells; },
    garrisonCapacity: military?.garrison,
    roof: art.roof,
    mechanism: art.mechanism,
    props: [...art.props],
    extension: art.extension,
    outputStorage: output && production ? { capacity: output.capacity, goods: production.outputs } : undefined,
    buildLimit: buildLimitOf(limits)
  };
});
const DEFINITION_BY_ID: readonly (BuildingDefinition | undefined)[] = BUILDING_CATALOG.reduce<BuildingDefinition[]>(
  (byId, definition) => { byId[definition.id] = definition; return byId; }, []);
export const getBuildingDefinition = (id: number): BuildingDefinition => {
  const definition = DEFINITION_BY_ID[id];
  if (!definition) throw new Error(`Unknown building ID: ${id}`);
  return definition;
};
export interface BuildingFrame {
  /** Read-only authored editor theme; absent retains the runtime island style. */
  enemyStyle?: import("./themed-neutral-building-style").EnemyBuildingStyle;
  enemyCatapultVariant?: import("../../shared/world/scenario-catapult").HostileCatapultVariant;
  catapultSupply?: import("../../shared/settlement/military-catapult-resupply").CatapultSupply;
  catapultGroundPoints?: {x:number;y:number;z:number}[];
  /** Oldest-first roof kind order, used only to tint the authored stone meshes. */
  catapultRackKinds?: import("../../shared/settlement/catapult-ammo-kinds").CatapultAmmoKind[];
  catapultAim?: number;
  catapultCycle?: import("../../shared/settlement/catapult-cycle").CatapultCycle;
  eventCourtyardWalls?: number[];
  enemyCampEnclosure?: "building";
  /** A bandit site (`bandit:` code and layout); `type` is then its catalog military building. */
  bandit?: import("./bandit-camp-plan").BanditSiteRef;
  nation?: import("../workers/worker-unit").WorkerNation;
  id: string;
  type: number;
  x: number;
  y: number;
  z: number;
  rotation: number;
  /** Authoritative simulation progress, 0..1. Never advanced by the renderer. */
  construction: number;
  working: boolean;
  /** Occupied at night: the shared window helper may show a faint warm glow. */
  windowLit?: boolean;
  productionPaused?: boolean;
  /** Building level 2-5 (absent: level 1); the model shows that level's additions. */
  level?: import("./levels/building-level").BuildingLevel;
  /** Work-cycle rate of an upgraded production building (1.1); its working animation runs this fast. */
  workRate?: number;
  /** Transient demolition visual; absent from simulation buildings and saves. */
  demolitionAge?: number;
  /**
   * A colony fort under direct assault: wall health (0–1), flames burning (one per 20 % lost, 0–5)
   * and, once the walls fell, seconds since then (burn, collapse, charred ruin).
   */
  fortSiege?: { health: number; flames: number; fallenAge?: number };
  /** Optional simulation-owned mechanism cycle, independent of rendering frame rate. */
  workTime?: number;
  pigFeedPhase?: "grain" | "water" | "breeding" | "idle" | null;
  /** The operator has removed the full bucket; the draw mechanism waits for its return. */
  wellBucketTaken?: boolean;
  /** Optional authoritative inventory; omitted in standalone previews and GLB exports. */
  outputStock?: Readonly<Record<string, number>>;
  inputStock?: Readonly<Record<string, number>>;
  /** Delivered upgrade materials waiting on the ground; hidden once the builder starts. */
  upgradeStock?: Readonly<Record<string, number>>;
  /** Requested building-upgrade progress, 0..1. */
  upgradeProgress?: number;
  /** Door opening supplied by arriving/departing workers, 0..1. */
  door: number;
  /** Independent local negative-X / positive-X entrance leaf openings; defaults to door. */
  doorLeaves?: readonly [number, number];
  /** Optional tower balcony door opening; defaults to door. */
  balconyDoor?: number;
  /** Linear RGB player color for tintable military cloth. */
  playerColor?: [number, number, number];
  /** Ownership supplied to the visual frame; zero identifies the local player. */
  owner?: number;
  /** Flag wind amplitude (0..2); zero means calm, independent of production. */
  windStrength?: number;
  /** Local wind heading in radians. */
  windDirection?: number;
}
