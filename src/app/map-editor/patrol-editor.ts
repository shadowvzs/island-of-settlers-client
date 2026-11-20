import type { I18n } from "@lingui/core";

import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { translateMessage } from "../../shared/i18n/translate";
import { validateMapScenario } from "../../shared/settlement/settlement-map-scenario";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import { MAX_PATROL_POINTS, MAX_SCENARIO_PATROL_POINTS, scenarioPatrolRoute,
  validScenarioPatrols } from "../../shared/world/scenario-patrol";
import type { WorldData } from "../../shared/world/world-data";
import type { EditorHistory } from "./editor-history";
import type { EditorStore } from "./editor-store";
import { bumpBuildRevision } from "./helpers";
import { editorMessage, MAP_EDITOR_MESSAGES as M } from "./messages";
import { createOverlayCanvas, fitOverlayCanvas } from "./overlay-canvas";
import { troopLabel } from "./scenario-form-controls";
import { createSectionStore, type FieldOption, keepOption } from "./section-store";

/** Per-unit closed links deliberately exclude stationed camp defenders and peaceful home maps. */
export const createPatrolEditor = (world: WorldData, viewport: HTMLElement, renderer: TerrainRenderer,
  history: EditorHistory, store: EditorStore, onEdit: () => boolean | void, i18n?: I18n) => {
  const section = createSectionStore({
    point: "", points: [] as readonly FieldOption[], unit: "", units: [] as readonly FieldOption[], x: "1", z: "1"
  });
  const selected = () => world.scenario?.units.find(unit => String(unit.id) === section.get().unit);
  const selectedWaypoint = () => {
    const value = section.get().point;
    if (value === "") return null;
    const index = Number(value), patrol = selected()?.patrol;
    return Number.isInteger(index) && index >= 0 && index < (patrol?.length ?? 0) ? index : null;
  };
  const showPoint = () => {
    const index = selectedWaypoint();
    const point = index === null ? undefined : selected()?.patrol?.[index];
    if (!point) {
      const unit = selected(); if (!unit) return;
      const x = unit.x < world.cellsX - 1 ? unit.x + 1 : Math.max(0, unit.x - 1);
      section.update({ x: String(x), z: String(unit.z) });
      return;
    }
    section.update({ x: String(point.x), z: String(point.z) });
  };
  const refreshPoints = () => {
    const previous = section.get().point;
    const points = (selected()?.patrol ?? []).map((point, index) =>
      ({ label: editorMessage(M.coordinate.patrolPointOption, {
        index: index + 1, x: point.x.toFixed(1), z: point.z.toFixed(1)
      }), value: String(index) }));
    const index = previous === "" ? 0 : Number(previous);
    const kept = Number.isInteger(index) && index >= 0 && index < points.length;
    section.update({ point: kept ? String(index) : points[0]?.value ?? "", points });
    showPoint();
  };
  const refresh = () => {
    const units = (world.scenario?.units ?? []).map(unit =>
      ({ label: editorMessage(M.coordinate.patrolUnitOption, {
        faction: unit.faction, id: unit.id, type: troopLabel(unit.type)
      }), value: String(unit.id) }));
    section.update({ unit: keepOption(units, section.get().unit), units });
    refreshPoints();
  };
  const mutate = (action: () => void) => {
    if (!world.scenario || world.scenario.kind === "home" || !selected()) {
      store.setHint(M.hints.chooseEnemyUnit, true); return;
    }
    if (onEdit() === false) return;
    history.begin(); action(); bumpBuildRevision(world);
    history.endStroke(); refresh();
  };
  const changePoint = (replace: boolean) => {
    const unit = selected(); if (!unit || !section.reportValidity("x", "z")) return;
    const patrol = [...unit.patrol ?? []], point = { x: section.valueAsNumber("x"), z: section.valueAsNumber("z") };
    const index = selectedWaypoint();
    if (replace && index === null) { store.setHint(M.hints.chooseWaypointMove, true); return; }
    if (replace) patrol[index!] = point;
    else patrol.push(point);
    const definitions = world.scenario!.units.map(other => other.id === unit.id ? { ...other, patrol } : other);
    if (!validScenarioPatrols(definitions, world.cellsX, world.cellsZ)) {
      store.setHint(editorMessage(M.hints.patrolDistinct, {
        perScenario: MAX_SCENARIO_PATROL_POINTS, perUnit: MAX_PATROL_POINTS
      }), true); return;
    }
    mutate(() => { unit.patrol = patrol; });
    store.setHint(M.hints.patrolSaved);
  };
  const removePoint = () => {
    const unit = selected(), index = selectedWaypoint();
    if (!unit || index === null) { store.setHint(M.hints.chooseWaypointRemove, true); return; }
    const patrol = unit.patrol!.filter((_, point) => point !== index);
    if (!validScenarioPatrols([{ ...unit, patrol }], world.cellsX, world.cellsZ)) {
      store.setHint(M.hints.patrolRemoveTooClose, true); return;
    }
    mutate(() => { unit.patrol = patrol.length ? patrol : undefined; });
  };
  const validate = () => {
    const errors = validateMapScenario(world);
    store.setHint(errors.length ? editorMessage(M.scenario.errors, { errors: errors.join("; ") }) :
      M.hints.patrolReachable, !!errors.length);
  };
  let show = false;
  const canvas = createOverlayCanvas(viewport);
  history.subscribe(refresh); refresh();
  const draw = (visible: boolean) => {
    const unit = selected(); canvas.hidden = !visible || !show || !unit?.patrol?.length;
    if (canvas.hidden || !unit) return;
    const context = fitOverlayCanvas(canvas, viewport); if (!context) return;
    const route = scenarioPatrolRoute(unit).map(point => renderer.projectToViewport(point.x,
      sampleSmooth(world, world.heights, point.x, point.z) + .3, point.z));
    context.strokeStyle = "#ffca76"; context.fillStyle = "#ffca76"; context.lineWidth = 2;
    context.font = "bold 13px system-ui";
    route.forEach((point, index) => {
      const end = route[(index + 1) % route.length]!;
      context.beginPath(); context.moveTo(point.x, point.y); context.lineTo(end.x, end.y); context.stroke();
      const angle = Math.atan2(end.y - point.y, end.x - point.x), mx = (point.x + end.x) / 2, my = (point.y + end.y) / 2;
      context.beginPath(); context.moveTo(mx, my);
      context.lineTo(mx - 8 * Math.cos(angle - .5), my - 8 * Math.sin(angle - .5));
      context.lineTo(mx - 8 * Math.cos(angle + .5), my - 8 * Math.sin(angle + .5)); context.closePath(); context.fill();
      const label = index ? String(index) : translateMessage(i18n, M.patrol.spawn);
      context.strokeStyle = "#322512"; context.strokeText(label, point.x, point.y);
      context.fillText(label, point.x, point.y); context.strokeStyle = "#ffca76";
    });
  };
  return {
    addPoint: () => changePoint(false),
    clear: () => { if (selected()?.patrol?.length) mutate(() => { delete selected()!.patrol; }); },
    draw,
    limits: { x: world.cellsX - .01, z: world.cellsZ - .01 },
    movePoint: () => changePoint(true),
    removePoint,
    section,
    selectPoint: (point: string) => { section.update({ point }); showPoint(); },
    selectUnit: (unit: string) => { section.update({ unit }); refreshPoints(); },
    toggleLinks: () => { show = !show; },
    validate
  };
};

export type PatrolEditor = ReturnType<typeof createPatrolEditor>;
