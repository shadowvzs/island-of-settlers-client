import { SAILING_SHIP_TURN_RADIUS } from "../../render-common/ships/ship-dimensions";
import type { WorldData } from "../world/world-data";
import type { RoadRouteSearch } from "./road-types";
import { inspectWalkingConnectivity, type WalkConnectivity } from "./scenario-connectivity-inspection";
import { inspectScenarioRoads } from "./scenario-road-placement";
import { createHarbourBerths } from "./settlement-harbour-berths";
import { harbourPlacementReason,inspectHarbourNavigation } from "./settlement-harbour-placement";
import { findOwnHeadquarters, isOwnBuilding } from "./settlement-home";
import { createScenarioInspectionContext } from "./settlement-map-scenario";
import { makeBuilding } from "./settlement-placement";
import type { ScenarioSpaceSite } from "./settlement-scenario-space";
import { createSeaMask } from "./settlement-sea-navigation";
import { createShipRoutePlanner, type ShipRoutePoint } from "./settlement-ship-routes";
import type { SettlementPoint } from "./settlement-types";

interface NavigationFinding { name: string; outcome: "witness" | "failure" | "unknown"; detail: string }
export interface ScenarioWorldNavigation {
  walking?: WalkConnectivity; findings: NavigationFinding[]; roadErrors: string[];
  marine?: { complete: boolean; sea: number; parallelX: number; parallelZ: number; turning: number; oceanTurning: number };
  routes: Array<{ name: string; from: SettlementPoint; points: ShipRoutePoint[] }>;
  harbourCount: number; complete: boolean; durationMs: number;
}
/** Whether a building entrance lies in the headquarters' static walking component. */
const walkingAccessFinding = (uid: number, component: number | undefined,
  homeComponent: number | undefined): NavigationFinding => {
  const name = `Walking access: building ${uid}`;
  if (!component) {
    return { name, outcome: "unknown",
      detail: "Entrance is not a clear half-cell node; native doorway escape requires an individual inspection." };
  }
  if (!homeComponent)
    return { name, outcome: "unknown", detail: "No clear headquarters component is available for comparison." };
  if (component === homeComponent)
    return { name, outcome: "witness", detail: "Entrance belongs to the headquarters walking component." };
  return { name, outcome: "failure",
    detail: "Entrance belongs to another walking component; sea travel or terrain changes are needed." };
};

const roadAccessOutcome = (route: RoadRouteSearch | undefined): NavigationFinding["outcome"] => {
  if (!route || route.status === "search-limit") return "unknown";
  return route.route ? "witness" : "failure";
};

/** Static whole-map topology and native swept-route evidence, never a voyage or economy simulation. */
export const inspectWorldNavigation = function* (world: WorldData, proposed: readonly ScenarioSpaceSite[] = [],
  maxMilliseconds = 15000): Generator<string, ScenarioWorldNavigation> {
  const started = performance.now(), expired = () => performance.now() - started >= maxMilliseconds;
  const report: ScenarioWorldNavigation = { findings: [], roadErrors: [], routes: [], harbourCount: 0, complete: false, durationMs: 0 };
  const finish = () => { report.durationMs = performance.now() - started; return report; };
  yield "Preparing authored navigation";
  const context = createScenarioInspectionContext(world);
  const walking = inspectWalkingConnectivity(context, expired);
  for (;;) {
    const step = walking.next();
    if (step.done) { report.walking = step.value; break; }
    yield `Whole-map walking graph: ${step.value} node/edge batches`;
  }
  if (!report.walking.complete) {
    report.findings.push({ name: "Walking connectivity", outcome: "unknown", detail: "Budget ended before the whole half-cell graph was exhausted; no isolation claim is made." });
    return finish();
  }
  report.findings.push({ name: "Walking connectivity", outcome: "witness",
    detail: `${report.walking.nodes} clear half-cell nodes in ${report.walking.components.length} complete static components. Separate islands may be intentional.` });
  for (const building of context.buildings) {
    const id = report.walking.labels[Math.round(building.access.z * 2) * report.walking.stride + Math.round(building.access.x * 2)];
    report.findings.push(walkingAccessFinding(building.uid, id, report.walking.homeComponent));
  }
  yield "Authored public road graph";
  if (expired()) return finish();
  report.roadErrors = inspectScenarioRoads(context, world.scenario?.roads ?? []);
  report.findings.push({ name: "Authored road strips and grading", outcome: report.roadErrors.length ? "failure" : "witness",
    detail: `${world.scenario?.roads?.length ?? 0} authored edges checked with native reserved-width, rock, signpost, overlap and whole-network grading rules.` });
  const home = findOwnHeadquarters(context);
  for (const building of context.buildings.filter(building => building !== home && isOwnBuilding(building))) {
    if (expired()) return finish();
    yield `Public road access: building ${building.uid}`;
    const route = home && context.options.roads.searchRoute?.(home.access, building.access);
    report.findings.push({ name: `Public road access: building ${building.uid}`, outcome: roadAccessOutcome(route),
      detail: route?.route ? "Actual authored road graph connects this entrance to HQ." : "No proven current authored road connection; this does not forbid building a future road." });
  }
  yield "Native sea, hull and turning masks";
  if (expired()) return finish();
  const marine = inspectHarbourNavigation(context), counts = { complete: false, sea: 0, parallelX: 0, parallelZ: 0, turning: 0, oceanTurning: 0 };
  const portals: SettlementPoint[] = [], margin = Math.ceil(SAILING_SHIP_TURN_RADIUS);
  for (let cell = 0; cell < world.cellsX * world.cellsZ; cell++) {
    if (cell % 1024 === 0) { yield `Sea clearance: ${cell} cells`; if (expired()) { report.marine = counts; return finish(); } }
    for (const key of ["sea", "parallelX", "parallelZ", "turning", "oceanTurning"] as const) counts[key] += Number(marine[key](cell));
    const x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
    if (marine.oceanTurning(cell) && (x === margin || z === margin || x === world.cellsX - margin - 1 || z === world.cellsZ - margin - 1))
      portals.push({ x: x + .5, z: z + .5 });
  }
  counts.complete = true; report.marine = counts;
  report.findings.push({ name: "Ocean and ship clearance", outcome: counts.oceanTurning ? "witness" : "failure",
    detail: `${counts.sea} draft-clear ocean cells; ${counts.turning} turning-clear cells, ${counts.oceanTurning} connected to the outer ocean. Lakes are excluded by native rules.` });
  if (expired()) return finish();
  const sea = createSeaMask(world), planner = createShipRoutePlanner(world, sea), berths = createHarbourBerths(context, sea, planner);
  for (const plot of proposed) if (!context.buildings.some(building => Math.hypot(building.x - plot.x, building.z - plot.z) < .1)) {
    const building = makeBuilding(context, 39, plot.x, plot.z, plot.rotation); building.construction = 1;
    context.nextBuilding++; context.buildings.push(building);
    for (let z = building.z - building.depth / 2; z < building.z + building.depth / 2; z++)
      for (let x = building.x - building.width / 2; x < building.x + building.width / 2; x++)
        context.occupied[z * world.cellsX + x] = 1;
    context.navigationRevision = (context.navigationRevision ?? 0) + 1;
  }
  const harbours = context.buildings.filter(building => building.typeId === 39);
  report.harbourCount = harbours.length;
  const poses: Array<{ uid: number; x: number; z: number; yaw: number }> = [];
  for (const harbour of harbours) {
    yield `Harbour ${harbour.uid}: berth, turn and swept ocean route`;
    if (expired()) return finish();
    const reason = harbourPlacementReason(context, harbour);
    const available = reason ? [] : berths.forHarbour(harbour.uid, true);
    report.findings.push({ name: `Harbour ${harbour.uid}`, outcome: available.length ? "witness" : "unknown", detail: reason ??
      `${available.length} native berth(s), including neighbouring-ship clearance when a second berth exists.` });
    const first = available[0]; if (!first || first.yaw === undefined) continue;
    const berth = { x: first.x, z: first.z, yaw: first.yaw };
    poses.push({ uid: harbour.uid, ...berth });
    let found = false, attempts = 0;
    const offshore = planner.offshore(berth);
    for (const portal of [...portals].sort((a, b) => Math.hypot(a.x - berth.x, a.z - berth.z) - Math.hypot(b.x - berth.x, b.z - berth.z))) {
      if (!offshore || !planner.connected(offshore, portal)) continue;
      if (expired() || attempts++ >= 8) break;
      const outbound = planner.route(berth, portal), inbound = outbound && planner.route({ ...portal, yaw: Math.atan2(berth.x - portal.x, berth.z - portal.z) }, { ...berth, eitherWay: true });
      if (!outbound || !inbound) continue;
      report.routes.push({ name: `Harbour ${harbour.uid} → ocean`, from: berth, points: outbound },
        { name: `Ocean → harbour ${harbour.uid}`, from: portal, points: inbound }); found = true; break;
    }
    report.findings.push({ name: `Harbour ${harbour.uid} ocean voyage geometry`, outcome: found ? "witness" : "unknown",
      detail: found ? "Native planner proved outbound and inbound swept hull/turn manoeuvres to outer-ocean clearance." : "No bidirectional witness in at most8 portal trials; bounded planner exhaustion is not impossibility." });
  }
  for (let a = 0; a < poses.length; a++) for (let b = a + 1; b < poses.length; b++) {
    yield `Harbour pair ${poses[a]!.uid}/${poses[b]!.uid}`;
    if (expired()) return finish();
    const first = poses[a]!, second = poses[b]!;
    const outbound = planner.route(first, { ...second, eitherWay: true }), inbound = planner.route(second, { ...first, eitherWay: true });
    report.findings.push({ name: `Harbour pair ${first.uid}/${second.uid}`, outcome: outbound && inbound ? "witness" : "unknown",
      detail: outbound && inbound ? "Native swept ship route exists in both directions." : "No bidirectional native route witness; bounded search or manoeuvring limits remain unknown." });
    if (outbound) report.routes.push({ name: `${first.uid} → ${second.uid}`, from: first, points: outbound });
    if (inbound) report.routes.push({ name: `${second.uid} → ${first.uid}`, from: second, points: inbound });
  }
  report.complete = !expired();
  report.findings.push({ name: "Scope", outcome: "unknown", detail: "Static authored/proposed geometry only: no moving traffic, passing fleets, throughput, live construction, conquest or resource lifecycle is simulated." });
  return finish();
};
