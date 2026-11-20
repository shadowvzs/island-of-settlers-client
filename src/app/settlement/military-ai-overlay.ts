import type { TerrainRenderer } from "../../render-common/renderer-contract";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import { UNIT_DECISION_REASON_CODES } from "../../shared/settlement/unit-decision-diagnostics";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { isOnScreen } from "../helpers";

/**
 * Debug overlay of the shipped military AI (development tools, never in normal play): flow-field
 * arrows per group target and the smart commander's influence map (red: the computer side is
 * stronger, blue: the player's side) with each squad's decision and score. A 2D canvas over the map,
 * projected with the renderer's last camera; the simulation data is read a few times per second, the
 * drawing follows the camera every frame.
 */
type AiDebug = ReturnType<SettlementSimulation["militaryAiDebug"]>;
type UnitSnapshot = ReturnType<SettlementSimulation["unitDiagnosticsSnapshot"]>;

/** Seconds between two reads of the simulation's debug data. */
const DATA_INTERVAL = .25;
const ARROW_LENGTH = .8;
/** Influence below this (soldier-equivalents) is not drawn. */
const INFLUENCE_FLOOR = .05;
const INFLUENCE_FULL = 6;
/** The movement owner counts sit below the top bar's status messages. */
const OWNER_LABEL_TOP = 84;
const UNIT_REASON_LABEL_TOP = OWNER_LABEL_TOP + 24;
/** Idle-type reasons drawn beside units; active units would only clutter the map. */
const ACTIVE_REASONS = new Set(["walking", "working"]);
const COLOURS = { action: "#fff7d6", flow: "#3fa9f5", flowMounted: "#f5a33f", text: "#111" } as const;

export const createMilitaryAiOverlay = (options: {
  getSimulation: () => SettlementSimulation | undefined;
  renderer: TerrainRenderer;
  viewport: HTMLElement;
  world: WorldData;
}) => {
  const { getSimulation, renderer, viewport, world } = options;
  const canvas = document.createElement("canvas");
  canvas.className = "military-ai-overlay";
  canvas.hidden = true;
  canvas.setAttribute("aria-hidden", "true");
  viewport.append(canvas);
  const context = canvas.getContext("2d")!;
  let data: AiDebug | undefined, units: UnitSnapshot | undefined, frame = 0, last = 0, age = DATA_INTERVAL;
  let enabled = false, disposed = false;

  const project = (x: number, z: number) => renderer.projectToViewport(x, sampleSmooth(world, world.heights, x, z), z);
  const drawArrow = (x: number, z: number, dx: number, dz: number, colour: string) => {
    const from = project(x, z), to = project(x + dx * ARROW_LENGTH, z + dz * ARROW_LENGTH);
    if (!isOnScreen(from) || !isOnScreen(to)) return;
    const angle = Math.atan2(to.y - from.y, to.x - from.x), head = 5;
    context.strokeStyle = colour;
    context.beginPath();
    context.moveTo(from.x, from.y); context.lineTo(to.x, to.y);
    context.lineTo(to.x - head * Math.cos(angle - .5), to.y - head * Math.sin(angle - .5));
    context.moveTo(to.x, to.y);
    context.lineTo(to.x - head * Math.cos(angle + .5), to.y - head * Math.sin(angle + .5));
    context.stroke();
  };
  const drawFlow = (fields: AiDebug["flowFields"]) => {
    context.lineWidth = 1.5;
    let remaining = 4096;
    for (const field of fields) for (const arrow of field.arrows) {
      if (--remaining < 0) return;
      drawArrow(arrow.x, arrow.z, arrow.dx, arrow.dz, field.mounted ? COLOURS.flowMounted : COLOURS.flow);
    }
  };
  const drawCell = (cell: number, value: number, influence: NonNullable<AiDebug["commander"]>) => {
    const x = cell % influence.columns * influence.cell, z = Math.floor(cell / influence.columns) * influence.cell;
    const corners = [[x, z], [x + influence.cell, z], [x + influence.cell, z + influence.cell], [x, z + influence.cell]]
      .map(([cornerX, cornerZ]) => project(cornerX!, cornerZ!));
    if (!corners.every(isOnScreen)) return;
    const alpha = Math.min(.45, Math.abs(value) / INFLUENCE_FULL * .45);
    context.fillStyle = value > 0 ? `rgba(220, 50, 40, ${alpha})` : `rgba(40, 110, 230, ${alpha})`;
    context.beginPath();
    corners.forEach((corner, index) => index ? context.lineTo(corner.x, corner.y) : context.moveTo(corner.x, corner.y));
    context.fill();
  };
  const drawLabel = (text: string, x: number, y: number) => {
    context.font = "bold 12px sans-serif";
    const width = context.measureText(text).width + 8;
    context.fillStyle = COLOURS.action; context.fillRect(x - width / 2, y - 22, width, 16);
    context.fillStyle = COLOURS.text; context.fillText(text, x - width / 2 + 4, y - 10);
  };
  const drawCommander = (commander: AiDebug["commander"]) => {
    if (!commander) return;
    const stride = Math.max(1, Math.ceil(commander.influence.length / 4096));
    for (let cell = 0; cell < commander.influence.length; cell += stride) {
      const value = commander.influence[cell]!;
      if (Math.abs(value) >= INFLUENCE_FLOOR) drawCell(cell, value, commander);
    }
    for (const decision of commander.decisions.slice(0, 128)) {
      const centre = project(decision.centre.x, decision.centre.z);
      if (!isOnScreen(centre)) continue;
      if (decision.target) drawArrow(decision.centre.x, decision.centre.z, (decision.target.x - decision.centre.x) /
        ARROW_LENGTH, (decision.target.z - decision.centre.z) / ARROW_LENGTH, COLOURS.action);
      drawLabel(`${decision.action} ${decision.score.toFixed(2)} (${decision.members})`, centre.x, centre.y);
    }
  };
  const drawUnitReason = (unit: UnitSnapshot["units"][number]) => {
    const point = project(unit.x, unit.z);
    if (isOnScreen(point)) drawLabel(`${unit.job}: ${unit.reason}`, point.x, point.y);
  };
  const drawUnitReasons = (snapshot: UnitSnapshot | undefined) => {
    if (!snapshot) return;
    for (const unit of snapshot.units)
      if (!ACTIVE_REASONS.has(unit.reason)) drawUnitReason(unit);
    const counts = UNIT_DECISION_REASON_CODES.filter(code => snapshot.counts[code] > 0)
      .map(code => `${code} ${snapshot.counts[code]}`).join(" · ");
    drawLabel(`unit reasons (${snapshot.visible} visible): ${counts || "none"}`, viewport.clientWidth / 2,
      UNIT_REASON_LABEL_TOP);
  };
  const draw = (time: number) => {
    frame = 0;
    if (!enabled || disposed || document.hidden) return;
    age += last ? Math.min(1, (time - last) / 1000) : DATA_INTERVAL; last = time;
    frame = requestAnimationFrame(draw);
    if (age >= DATA_INTERVAL) {
      age = 0;
      const simulation = getSimulation();
      data = simulation?.militaryAiDebug();
      units = simulation?.unitDiagnosticsSnapshot();
    }
    const { clientHeight: height, clientWidth: width } = viewport, ratio = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
    if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!data) return;
    drawCommander(data.commander);
    drawUnitReasons(units);
    drawFlow(data.flowFields);
    const { flow, path } = data.owners;
    drawLabel(`movement owners: path ${path} · flow ${flow} · hand-overs ${data.handovers}`, width / 2,
      OWNER_LABEL_TOP);
  };
  const suspend = () => { cancelAnimationFrame(frame); frame = 0; last = 0; };
  const resume = () => {
    suspend();
    if (enabled && !disposed && !document.hidden) { age = DATA_INTERVAL; frame = requestAnimationFrame(draw); }
  };
  const dispose = () => {
    disposed = true; enabled = false; suspend(); data = undefined; canvas.remove();
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("pagehide", onPageHide); window.removeEventListener("pageshow", resume);
  };
  const onPageHide = (event: PageTransitionEvent) => { if (event.persisted) suspend(); else dispose(); };
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("pagehide", onPageHide); window.addEventListener("pageshow", resume);
  return {
    dispose,
    setVisible: (visible: boolean) => {
      if (disposed) return;
      enabled = visible; canvas.hidden = !visible;
      if (!visible) data = undefined;
      resume();
    }
  };
};
