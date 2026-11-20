import { banditByMilitaryBuilding } from "@shared/catalog";

import {
  banditCampPlan, banditSiteOfMilitaryType, type BanditSiteRef
} from "../../render-common/buildings/bandit-camp-plan";
import { getBuildingDefinition } from "../../render-common/buildings/building-catalog";
import { validateMapScenario } from "../../shared/settlement/settlement-map-scenario";
import { type ScenarioFormation,scenarioGroupPoints } from "../../shared/world/editing/scenario-group";
import { activeFactionAi } from "../../shared/world/scenario-faction-ai";
import { createMapScenario, type MapScenario, type ScenarioPoint } from "../../shared/world/map-scenario";
import type { ScenarioCatapult } from "../../shared/world/scenario-catapult";
import { scenarioGarrisonCapacity } from "../../shared/world/scenario-garrison";
import { allocateScenarioObjectId } from "../../shared/world/scenario-object-ids";
import type { WorldData } from "../../shared/world/world-data";
import type { EditorHistory } from "./editor-history";
import type { EditorStore } from "./editor-store";
import { createBuildingAvailabilityControls } from "./building-availability/building-availability-controls";
import { bumpBuildRevision } from "./helpers";
import { dropForbiddenRules } from "./map-rules/helpers";
import { createMapRulesControls } from "./map-rules/map-rules-controls";
import { editorMessage, MAP_EDITOR_MESSAGES as M } from "./messages";
import { scenarioBuildingName } from "./scenario-catapult-helpers";
import { createCatapultInspector } from "./scenario-catapult-inspector";
import {
  areEnemiesBlocked, ENEMIES_NEED_SCENARIO_HINT, hasAuthoredEnemies, HOME_KIND_BLOCKED_HINT
} from "./scenario-enemy-policy";
import { createEnemyFormFields, createScenarioMapFields, troopLabel } from "./scenario-form-controls";
import { createScenarioGarrisonControls } from "./scenario-garrison-controls";
import {
  isScenarioSelectionInScope, type ScenarioEntry, type ScenarioSelectionScope,
toScenarioSelectionView} from "./scenario-selection-controls";
import { selectedObjectId, warnScriptObjectRemoved } from "./script-object-warning";
import { createSectionStore, toBoundedWhole } from "./section-store";

type Mode = "select" | "move" | "hq" | "landing" | "unit" | "building";
const snap = (world: WorldData, point: ScenarioPoint, type: number, turns: number, bandit?: BanditSiteRef) => {
  const [w, d] = bandit === undefined ? getBuildingDefinition(type).gridFootprint : banditCampPlan(bandit).cells;
  const px = (turns % 2 ? d : w) % 2 / 2, pz = (turns % 2 ? w : d) % 2 / 2;
  return { x: Math.max(px, Math.min(world.cellsX - 1 + px, Math.round(point.x - px) + px)),
    z: Math.max(pz, Math.min(world.cellsZ - 1 + pz, Math.round(point.z - pz) + pz)) };
};
const scenarioEntries = (value?: MapScenario): ScenarioEntry[] => {
  if (!value) return [];
  const result: ScenarioEntry[] = [];
  if (value.headquarters) result.push(["hq", M.scenario.headquarters, value.headquarters]);
  if (value.landing) result.push(["landing", M.scenario.landing, value.landing]);
  for (const unit of value.units) result.push([`unit:${unit.id}`,
    editorMessage(M.scenario.unitEntry, { id: unit.id, type: troopLabel(unit.type) }), unit]);
  for (const entry of value.buildings) result.push([`building:${entry.id}`,
    editorMessage(M.coordinate.scenarioBuildingOption, { id: entry.id, name: scenarioBuildingName(entry) }), entry]);
  return result;
};
const EMPTY_SELECTION = toScenarioSelectionView([], "", "map");
/** Camp-only appearance fields stay absent on plain military buildings (no undefined keys in saves). */
const campAppearance = (bandit: BanditSiteRef | undefined, enclosure: "building" | undefined) => ({
  ...(bandit === undefined ? {} : { bandit: { code: bandit.code, layout: bandit.layout } }),
  ...(enclosure === undefined ? {} : { enclosure })
});

export const createScenarioEditor = (world: WorldData, store: EditorStore, history: EditorHistory,
  onEdit: () => boolean | void, onPlay: () => void) => {
  const mapSection = createSectionStore({ ...createScenarioMapFields(), ...EMPTY_SELECTION });
  const unitsSection = createSectionStore({ ...createEnemyFormFields(), ...toScenarioSelectionView([], "", "units"),
    enemiesBlocked: areEnemiesBlocked(undefined) });
  const garrison = createScenarioGarrisonControls();
  let selected = "", mode: Mode = "select";
  let scope: ScenarioSelectionScope = "map";
  const scenario = () => world.scenario;
  const rotation = () => toBoundedWhole(mapSection.get().hqRotation, 0, 3);
  const setRotation = (turns: number) => {
    const text = String(toBoundedWhole(String(turns), 0, 3));
    mapSection.update({ hqRotation: text }); unitsSection.update({ unitRotation: text });
  };
  const enemy = (name: "count" | "defenders" | "faction" | "group" | "rank" | "spacing", min: number, max: number) =>
    unitsSection.number(name, min, max);
  const faction = () => enemy("faction", 1, 16), rank = () => enemy("rank", 0, 2);
  const group = () => enemy("group", 0, 1000);
  /** Type 0 is an AI faction's depot, not an ordinary hostile building. */
  const allowsEnemyHeadquarters = (scenario: MapScenario, factionId: number) =>
    activeFactionAi(scenario.factionAi).some(entry => entry.faction === factionId);
  const refuseHeadquarters = (scenario: MapScenario, type: number, factionId: number) => {
    if (type !== 0 || allowsEnemyHeadquarters(scenario, factionId)) return false;
    store.setHint(M.hints.enemyHqNeedsAi, true);
    return true;
  };
  const selectedPoint = () => {
    if (selected === "hq") return scenario()?.headquarters;
    if (selected === "landing") return scenario()?.landing;
    const [kind, id] = selected.split(":");
    return (kind === "unit" ? scenario()?.units : scenario()?.buildings)?.find(entry => entry.id === Number(id));
  };
  const mutate = (change: (value: MapScenario) => void | false) => {
    if (onEdit() === false) return;
    history.begin();
    // An empty stock is the nation default (GS-MAP): an Indigenous map keeps its 48 cloth.
    world.scenario ??= createMapScenario();
    if (change(world.scenario) === false) { history.endStroke(); return; }
    bumpBuildRevision(world);
    history.endStroke(); render();
  };
  const mapRules = createMapRulesControls({ cells: () => world, edit: mutate, scenario });
  const buildingAvailability = createBuildingAvailabilityControls({ edit: mutate, scenario, world: () => world });
  const catapultInspector = createCatapultInspector((id, change) => {
    let accepted = false;
    mutate(value => {
      const entry = value.buildings.find(candidate => candidate.id === id && candidate.catapult);
      if (!entry || selected !== `building:${id}`) return false;
      Object.assign(entry, change); accepted = true;
    });
    return accepted;
  });
  const mutateSelected = (target: ScenarioSelectionScope, change: (value: MapScenario) => void) => {
    if (!selectedPoint() || !isScenarioSelectionInScope(selected, target)) {
      store.setHint(target === "map" ? M.hints.scenarioHqFirst : M.hints.scenarioUnitFirst, true); return;
    }
    mutate(change);
  };
  const activate = (value: Mode, selectionScope: ScenarioSelectionScope = "map") => {
    mode = value; scope = selectionScope;
    store.selectTool("scenario");
    store.setHint(editorMessage(M.hints.scenarioMode, { mode: M.scenario.mode[value] }));
  };
  /** A peaceful home has no enemy placement: leave that mode before the tool reports a stale hint. */
  const stopEnemyPlacement = () => {
    if (mode !== "unit" && mode !== "building") return;
    mode = "select";
    store.clearTool();
  };
  const setKind = (value: string) => {
    const kind = value as MapScenario["kind"];
    if (kind === "home" && hasAuthoredEnemies(scenario())) {
      stopEnemyPlacement();
      store.setHint(HOME_KIND_BLOCKED_HINT, true); render(); return;
    }
    if (kind === "home") stopEnemyPlacement();
    mapSection.update({ kind: value });
    mutate(scenario => { scenario.kind = kind; dropForbiddenRules(scenario); });
  };
  /** The selected bandit site (undefined: a military building) and the garrison it may hold. */
  const readBuilding = () => {
    const { building, model } = unitsSection.get();
    const variant = building.endsWith("-catapult") ? building.split("-")[0] as "bandit" | "pirate" : undefined;
    const type = variant ? 16 : Number(building);
    const stones = unitsSection.number("catapultStones", 0, 6);
    const previous = scenario()?.buildings.find(entry => `building:${entry.id}` === selected)?.catapult;
    const catapult: ScenarioCatapult | undefined = variant ? { variant, stones,
      ...(previous?.variant === variant && previous.roofStones !== undefined
        ? { roofStones: Math.min(stones, previous.roofStones) } : {}) } : undefined;
    const bandit = model === "military" || !banditByMilitaryBuilding(type)
      ? undefined : banditSiteOfMilitaryType(type, Number(model.at(-1)));
    const capacity = scenarioGarrisonCapacity({ bandit, type });
    const troops = garrison.read({ bandit, type, defenders: Math.min(capacity, enemy("defenders", 0, 12)) });
    if (!troops) store.setHint(editorMessage(M.hints.garrisonCapacity, { capacity }), true);
    const enclosure = bandit !== undefined && model.startsWith("lodge") ? "building" as const : undefined;
    return { bandit, catapult, enclosure, troops, type };
  };
  const showSelected = () => {
    const unit = scenario()?.units.find(unit => `unit:${unit.id}` === selected);
    const entry = scenario()?.buildings.find(entry => `building:${entry.id}` === selected);
    catapultInspector.show(entry);
    if (unit) unitsSection.update({ faction: String(unit.faction), group: String(unit.group), rank: String(unit.rank),
      troop: unit.type });
    if (entry) {
      garrison.show(entry);
      unitsSection.update({ building: entry.catapult ? `${entry.catapult.variant}-catapult` : String(entry.type),
        catapultStones: String(entry.catapult?.stones ?? 6), defenders: String(entry.defenders),
        faction: String(entry.faction),
        model: entry.bandit === undefined ? "military"
          : `${entry.enclosure ? "lodge" : "tent"}-${entry.bandit.layout}` });
    }
    const point = selectedPoint();
    if (point && "rotation" in point) setRotation(Number(point.rotation));
  };
  const applySelectedEnemy = () => mutateSelected("units", scenario => {
    const unit = scenario.units.find(unit => `unit:${unit.id}` === selected);
    const entry = scenario.buildings.find(entry => `building:${entry.id}` === selected);
    if (unit) Object.assign(unit, { rank: rank(), faction: faction(), group: group(), type: unitsSection.get().troop });
    if (entry) {
      if (!unitsSection.reportValidity("defenders")) return false;
      const { bandit, catapult, enclosure, troops, type } = readBuilding();
      if (!troops) return false;
      const factionId = faction();
      if (refuseHeadquarters(scenario, type, factionId)) return false;
      delete entry.bandit; delete entry.enclosure; delete entry.catapult;
      Object.assign(entry, troops, snap(world, entry, type, rotation(), bandit), {
        ...campAppearance(bandit, enclosure), ...(catapult ? { catapult } : {}),
        type, rotation: rotation(), faction: factionId
      });
    }
  });
  const rotateSelected = () => {
    const point = selectedPoint();
    if (point && "rotation" in point) {
      point.rotation = (Number(point.rotation) + 1) % 4;
      const type = "type" in point ? Number(point.type) : 0;
      const bandit = "bandit" in point ? point.bandit as BanditSiteRef : undefined;
      Object.assign(point, snap(world, point, type, Number(point.rotation), bandit));
    }
    if (point && "heading" in point) point.heading = Number(point.heading) + Math.PI / 2;
  };
  const removeSelected = (scenario: MapScenario) => {
    if (selected === "hq") delete scenario.headquarters;
    if (selected === "landing") delete scenario.landing;
    scenario.units = scenario.units.filter(entry => `unit:${entry.id}` !== selected);
    scenario.buildings = scenario.buildings.filter(entry => `building:${entry.id}` !== selected);
    selected = "";
  };
  const validate = () => {
    const errors = validateMapScenario(world);
    store.setHint(errors.length ? editorMessage(M.scenario.errors, { errors: errors.join("; ") }) :
      M.hints.scenarioReady, errors.length > 0);
  };
  const entries = () => scenarioEntries(scenario());
  const render = () => {
    const objects = entries();
    if (!objects.some(([id]) => id === selected)) selected = "";
    mapSection.update({ ...toScenarioSelectionView(objects, selected, "map"), kind: scenario()?.kind ?? "home",
      nation: scenario()?.nation ?? "roman", theme: scenario()?.theme ?? "forest" });
    unitsSection.update({ ...toScenarioSelectionView(objects, selected, "units"),
      enemiesBlocked: areEnemiesBlocked(scenario()) });
    showSelected();
    mapSection.update({
      claim: String(scenario()?.claimSeconds ?? 0), expiry: String(scenario()?.expirySeconds ?? 0),
      objective: scenario()?.objective ?? "capture", reward: String(scenario()?.rewardCoins ?? 0)
    });
    mapRules.refresh();
    buildingAvailability.refresh();
  };
  history.subscribe(render); render();
  const placeUnits = (scenario: MapScenario, point: ScenarioPoint, nextId: () => number | null) => {
    const { facing, formation, troop } = unitsSection.get();
    let heading = rotation() * Math.PI / 2;
    if (facing === "toward landing" && scenario.landing)
      heading = Math.atan2(scenario.landing.x - point.x, scenario.landing.z - point.z);
    const distance = enemy("spacing", 1, 4);
    for (const { x, z } of scenarioGroupPoints(point, enemy("count", 1, 32), distance, formation as ScenarioFormation, heading)) {
      if (scenario.units.length >= 512 || x < .2 || z < .2 || x >= world.cellsX - .2 || z >= world.cellsZ - .2 ||
        scenario.units.some(unit => Math.hypot(unit.x - x, unit.z - z) < .45)) continue;
      const id = nextId();
      if (id === null) return;
      scenario.units.push({ id, x, z, faction: faction(), rank: rank(), group: group(),
        heading, type: troop as "shield" });
      selected = `unit:${id}`;
    }
  };
  const placeBuilding = (scenario: MapScenario, point: ScenarioPoint, nextId: () => number | null) => {
    if (!unitsSection.reportValidity("defenders")) return false;
    const { bandit, catapult, enclosure, troops, type } = readBuilding();
    if (!troops) return false;
    const factionId = faction();
    if (refuseHeadquarters(scenario, type, factionId)) return false;
    const id = nextId();
    if (id === null) return false;
    scenario.buildings.push({ id, ...snap(world, point, type, rotation(), bandit), type,
      rotation: rotation(), faction: factionId, ...troops, ...campAppearance(bandit, enclosure),
      ...(catapult ? { catapult } : {}) });
    selected = `building:${id}`;
  };
  const selectNearest = (point: ScenarioPoint) => {
    const nearest = entries().filter(([id]) => isScenarioSelectionInScope(id, scope))
      .sort((a, b) => Math.hypot(a[2].x - point.x, a[2].z - point.z) -
      Math.hypot(b[2].x - point.x, b[2].z - point.z))[0];
    selected = nearest && Math.hypot(nearest[2].x - point.x, nearest[2].z - point.z) < 5 ? nearest[0] : "";
    render();
  };
  const stamp = (point: ScenarioPoint) => {
    if (mode === "select") { selectNearest(point); return; }
    if ((mode === "unit" || mode === "building") && areEnemiesBlocked(scenario())) {
      store.setHint(ENEMIES_NEED_SCENARIO_HINT, true); return;
    }
    if (mode === "move" && (!selectedPoint() || !isScenarioSelectionInScope(selected, scope))) {
      store.setHint(M.hints.scenarioObjectFirst, true); return;
    }
    mutate(scenario => {
      const nextId = () => allocateScenarioObjectId(scenario);
      if (mode === "hq") { scenario.headquarters = { ...snap(world, point, 0, rotation()), rotation: rotation() }; selected = "hq"; }
      if (mode === "landing") { scenario.landing = { ...point }; selected = "landing"; }
      if (mode === "move") {
        const entry = selectedPoint();
        if (entry) Object.assign(entry, "rotation" in entry ? snap(world, point, "type" in entry ? entry.type as number : 0, Number(entry.rotation),
          "bandit" in entry ? entry.bandit as BanditSiteRef : undefined) : point);
      }
      if (mode === "unit") placeUnits(scenario, point, nextId);
      if (mode === "building" && scenario.buildings.length < 128) return placeBuilding(scenario, point, nextId);
    });
  };
  return {
    activate,
    applyRules: () => {
      mutate(scenario => {
        scenario.objective = mapSection.get().objective as MapScenario["objective"];
        scenario.rewardCoins = mapSection.number("reward", 0, 100000);
        scenario.claimSeconds = mapSection.number("claim", 0, 31536000);
        scenario.expirySeconds = mapSection.number("expiry", 0, 31536000);
      });
      store.setHint(M.hints.scenarioRulesApplied);
    },
    applySelectedEnemy,
    buildingAvailability,
    catapultInspector,
    garrison,
    mapRules,
    mapSection,
    play: onPlay,
    remove: (target: ScenarioSelectionScope) => {
      const objectId = selectedObjectId(selected);
      mutateSelected(target, removeSelected);
      warnScriptObjectRemoved(world, store, objectId);
    },
    rotate: (target: ScenarioSelectionScope) => mutateSelected(target, rotateSelected),
    select: (target: ScenarioSelectionScope, id: string) => { selected = id; scope = target; render(); },
    setEnemyBuilding: (value: string) => {
      const change: Partial<ReturnType<typeof createEnemyFormFields>> = { building: value };
      if (value === "0") change.defenders = "0";
      if (value.endsWith("-catapult") && unitsSection.number("defenders", 0, 12) === 0)
        change.defenders = "2";
      unitsSection.update(change);
    },
    setKind,
    setNation: (value: string) => {
      mapSection.update({ nation: value });
      mutate(scenario => { scenario.nation = value as MapScenario["nation"]; });
    },
    /** Both tabs' rotation fields show the text typed in either. */
    setRotationText: (text: string) => {
      mapSection.update({ hqRotation: text }); unitsSection.update({ unitRotation: text });
    },
    commitRotation: () => setRotation(rotation()),
    setTheme: (value: string) => {
      mapSection.update({ theme: value });
      mutate(scenario => { scenario.theme = value as MapScenario["theme"]; });
    },
    stamp,
    unitsSection,
    validate
  };
};

export type ScenarioEditor = ReturnType<typeof createScenarioEditor>;
