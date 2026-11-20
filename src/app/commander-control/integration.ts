import type { I18n } from "@lingui/core";

import type { ExplorationFrame } from "../../render-common/exploration/exploration-frame";
import { HORSE_WITHERS_HEIGHT } from "../../render-common/mounts/horse-dimensions";
import type { FrameState, TerrainRenderer } from "../../render-common/renderer-contract";
import { actorActionEnabled } from "../../render-common/workers/actor-action-capabilities";
import { WORKER_HEIGHT } from "../../render-common/workers/worker-dimensions";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import { explorationInputPolicy } from "../exploration/contracts";
import { createExplorationInput } from "../exploration/input/controller";
import type { ExplorationInputGate } from "../exploration/input/gate";
import { createExplorationHudScope } from "../exploration/ui/hud-scope";
import { hotkeyEventAllowed, possessedActionForCode } from "../settings/hotkeys/bindings";
import { commanderPortrait } from "../settlement/army-icons";
import { createCommanderPossessionController } from "../settlement/commander-possession-controller";
import { getWindowLayer, isolatePointer } from "../window-layer";
import { commanderControlEntryVisible, commanderExplorationHeroes } from "./helpers";
import { createCommanderRenderPose } from "./render-pose";
import { type CommanderUiState, mountCommanderControls } from "./ui";

export interface IslandCommanderOptions {
  canControl: () => boolean;
  canStart: () => boolean;
  closeWindows: () => void;
  gate: ExplorationInputGate;
  i18n: I18n;
  rain: () => number;
  renderer: TerrainRenderer;
  simulation: SettlementSimulation;
  viewport: HTMLElement;
  /** The rendered worker frames: the escort bodies are resolved through them for prewarm. */
  workerFrames: () => readonly WorkerFrame[];
}

/** One input/camera lease over the actual army body. Scout keeps its separate presentation controller. */
export const createIslandCommander = (options: IslandCommanderOptions) => {
  const { gate, renderer, simulation, workerFrames } = options;
  const controller = createCommanderPossessionController(simulation, options.canControl);
  const scope = createExplorationHudScope(document.documentElement);
  const originalCommanderScope = document.documentElement.getAttribute("data-commander-control");
  const host = document.createElement("div"); host.className = "commander-control-host";
  getWindowLayer(options.viewport).append(host);
  isolatePointer(host);
  let disposed = false, preparingResources = false, wasOwner = false, token = 0, revision = 0;
  let releaseView: (() => void) | undefined, notice: string | undefined;
  let entryStage = "idle", frameDelta = 0;
  /** CIN3: a campaign cinematic holds the commander view (no input, no leave on blur/background). */
  let suspended = false;
  const renderPose = createCommanderRenderPose();
  const owns = () => preparingResources || controller.preparing() || controller.active();
  const leave = () => {
    entryStage = "left";
    token++; preparingResources = false; controller.leave(); input.clearHeldInputs(); renderPose.clear();
    releaseView?.(); releaseView = undefined;
    scope.sync("idle"); gate.setPhase("idle"); publish();
  };
  const input = createExplorationInput({ callbacks: {
    onEscape: leave, onLeave: leave,
    onLook: (yaw, pitch) => controller.setLook(yaw, pitch, frameDelta),
    onMovement: controller.setMovement,
    onCommanderAction: controller.action, onSpyglass: () => undefined
  } });
  const state = (): CommanderUiState => {
    const commander = simulation.commanderSnapshot();
    let phase: CommanderUiState["phase"] = "idle";
    if (preparingResources || controller.preparing()) phase = "preparing";
    if (controller.active()) phase = "active";
    return { phase, aiming: phase === "active" && commander?.definition.loadout === "bow" &&
      actorActionEnabled("commander", "attack"),
      canEnter: Boolean(commander && commanderControlEntryVisible(commander) && options.canStart() &&
        !commander.recoverySeconds && commander.hp > 0),
      showEntry: commanderControlEntryVisible(commander),
      hp: commander?.hp ?? 0, maximum: commander?.maximumHp ?? 1, name: commander?.name ?? "",
      portrait: commanderPortrait(commander?.nation ?? simulation.playerNation()), notice: notice ?? controller.notice() };
  };
  const enter = async () => {
    if (disposed || owns()) return;
    if (!options.canStart() || !simulation.commanderSnapshot()) {
      entryStage = "blocked"; notice = "Finish the current action before controlling the commander"; publish(); return;
    }
    entryStage = "preparing-view";
    const entry = ++token; preparingResources = true; notice = undefined; publish();
    options.closeWindows();
    let release: (() => void) | undefined;
    try {
      // The commander (possibly still in the lodge) and the selected escort are preloaded first.
      release = await renderer.prepareExplorationView?.(commanderExplorationHeroes(
        simulation.commanderSnapshot(), simulation.militarySoldiers(), workerFrames()));
      entryStage = "view-ready";
      if (disposed || token !== entry || !options.canControl()) { release?.(); return; }
      const result = controller.enter();
      entryStage = result.ok ? "deploying" : "refused";
      if (!result.ok) { notice = result.reason; release?.(); preparingResources = false; publish(); return; }
      releaseView = release; preparingResources = false; publish();
    } catch (error) {
      release?.();
      if (disposed || token !== entry) return;
      notice = error instanceof Error ? error.message : "Commander view could not be prepared";
      preparingResources = false; publish();
    }
  };
  const ui = mountCommanderControls(host, input, state(), { enter: () => { void enter(); }, leave,
    action: (action, held) => { controller.action(action, held); } }, options.i18n);
  const publish = () => {
    if (disposed) return;
    const active = owns();
    let phase: "idle" | "entering" | "possessed" = "idle";
    if (active) phase = "entering";
    if (controller.active()) phase = "possessed";
    if (active || wasOwner) {
      scope.sync(phase); gate.setPhase(phase);
      if (active) document.documentElement.setAttribute("data-commander-control", "active");
      else if (originalCommanderScope === null) document.documentElement.removeAttribute("data-commander-control");
      else document.documentElement.setAttribute("data-commander-control", originalCommanderScope);
    }
    wasOwner = active;
    input.setPolicy(explorationInputPolicy(phase, "commander"));
    ui.publish(state());
  };
  const stopTicks = simulation.observeTicks(() => {
    if (!owns() && releaseView) { releaseView(); releaseView = undefined; }
    publish();
  });
  const background = () => { if (document.hidden && owns() && !suspended) leave(); };
  const blur = () => { if (owns() && !suspended) leave(); };
  const preparingEscape = (event: KeyboardEvent) => {
    if (suspended || !owns() || controller.active() || !hotkeyEventAllowed(event) || possessedActionForCode(event.code) !== "back") return;
    event.preventDefault(); leave();
  };
  document.addEventListener("visibilitychange", background);
  window.addEventListener("blur", blur);
  window.addEventListener("keydown", preparingEscape, true);
  const frame = (rendered?: Pick<FrameState, "workers" | "cavalryMounts">): ExplorationFrame | undefined => {
    const actual = controller.snapshot();
    if (!actual) return undefined;
    if (actual.aimPoint) {
      const point = actual.aimPoint;
      ui.positionAim(renderer.projectToViewport(point.x, point.y, point.z));
    }
    const pose = renderPose.sample(actual, rendered), look = controller.view() ?? actual;
    const drawnMount = actual.mounted ? rendered?.cavalryMounts?.find(body => body.actorId === actual.actor) : undefined;
    const rigEye = renderer.militaryEyeOffset?.(actual.actor, actual.mounted, drawnMount);
    let eyeHeight = WORKER_HEIGHT * .93;
    if (actual.mounted) eyeHeight += HORSE_WITHERS_HEIGHT * .80;
    if (rigEye) eyeHeight = rigEye.y;
    // Bow hands sit at the actual anatomical reach; a long sword-camera offset would pass them.
    let forward = .17;
    if (actual.definition.loadout === "bow") forward = .08;
    if (actual.definition.loadout === "axe" && actual.nation === "viking") forward = .1;
    const x = pose.x + (rigEye?.x ?? 0) + Math.sin(pose.yaw) * forward;
    const z = pose.z + (rigEye?.z ?? 0) + Math.cos(pose.yaw) * forward;
    const y = pose.y + eyeHeight;
    return { appearance: null, bubble: null, revision: ++revision, smoke: null,
      weather: { active: true, rain: options.rain(), cameraX: x, cameraY: y, cameraZ: z },
      camera: { blend: 1, pose: { x, y, z, eyeBaseY: pose.y, eyeHeight, yaw: look.yaw, pitch: look.pitch,
        fov: Math.PI * 65 / 180, mode: "eye" } } };
  };
  return {
    controller, owns, frame,
    debug: () => ({ entryStage, canStart: options.canStart(), canControl: options.canControl(),
      normalized: gate.snapshot().normalized, notice,
      viewLeaseHeld: Boolean(releaseView), preparingResources, renderPose: renderPose.current(),
      resources: renderer.getResourceStats?.() }),
    setSuspended: (next: boolean) => {
      if (disposed || next === suspended) return;
      suspended = next;
      input.setSuspended(next);
    },
    update: (dt: number) => {
      if (disposed) return;
      if (owns() && !options.canControl()) { leave(); return; }
      frameDelta = dt;
      input.update(dt);
    },
    dispose: () => {
      if (disposed) return;
      leave(); disposed = true; stopTicks(); controller.dispose(); input.dispose(); ui.dispose(); scope.dispose();
      document.removeEventListener("visibilitychange", background); window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", preparingEscape, true); host.remove();
    }
  };
};
