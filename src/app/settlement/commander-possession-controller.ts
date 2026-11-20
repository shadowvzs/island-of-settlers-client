import { COMMANDER_INPUT_BUTTON, type CommanderInput } from "../../../../island-of-settlers-shared/src/commander-input";
import { actorActionEnabled } from "../../render-common/workers/actor-action-capabilities";
import type { CommanderFollowType } from "../../shared/settlement/military-direct-state";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { CommanderHotkeyAction } from "../settings/hotkeys/bindings";

type CommanderPort = Pick<SettlementSimulation, "beginCommanderControl" | "commanderControlProblem" |
  "commanderControlSnapshot" | "commanderSnapshot" | "deployCommander" | "endCommanderControl" |
  "frames" | "gameTick" | "militarySoldiers" | "observeTicks" | "setCommanderFollow" |
  "submitCommanderInput" | "assignCommanderEscort">;
type ButtonAction = keyof typeof COMMANDER_INPUT_BUTTON;
const TAU = Math.PI * 2;
const wrapAngle = (angle: number) => ((angle % TAU) + TAU) % TAU;
const EDGE_BUTTONS = COMMANDER_INPUT_BUTTON.dismount | COMMANDER_INPUT_BUTTON.callHorse;
const finiteClamp = (value: number, low: number, high: number) =>
  Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : 0;

/** Input intents only. The actual commander service owns movement, HP, horse and attack cadence. */
export const createCommanderPossessionController = (simulation: CommanderPort, canEnter: () => boolean) => {
  let pending: { actor: number; commander: string } | null = null;
  let generation: number | null = null, lastSentTick = -1;
  let forward = 0, right = 0, yaw = 0, pitch = 0, yawDelta = 0, pitchDelta = 0, buttons = 0;
  let viewYaw = 0, viewPitch = 0;
  let disposed = false, notice: string | undefined;
  const clearInputs = () => { forward = 0; right = 0; yawDelta = 0; pitchDelta = 0; buttons = 0; };
  const leave = () => {
    if (generation !== null) simulation.endCommanderControl(generation);
    generation = null; pending = null; clearInputs();
  };
  const begin = (actor: number) => {
    const result = simulation.beginCommanderControl(actor);
    if (!result.ok) { notice = result.reason; pending = null; return result; }
    const actual = simulation.commanderControlSnapshot();
    if (!actual || actual.generation !== result.generation) {
      simulation.endCommanderControl(result.generation);
      return { ok: false as const, reason: "Commander control changed during entry" };
    }
    generation = result.generation; lastSentTick = simulation.gameTick();
    simulation.assignCommanderEscort(simulation.militarySoldiers()
      .filter(row => row.combat?.selected && !row.commanderId).map(row => row.actor));
    yaw = viewYaw = actual.yaw; pitch = viewPitch = actual.pitch;
    pending = null; notice = undefined; clearInputs();
    return { ok: true as const };
  };
  const enter = () => {
    if (disposed || pending || generation !== null || !canEnter())
      return { ok: false as const, reason: "Finish the current action before controlling the commander" };
    const commander = simulation.commanderSnapshot();
    const soldier = simulation.militarySoldiers().find(row => row.commanderId === commander?.id);
    if (!commander || !soldier) return { ok: false as const, reason: "Recruit a commander first" };
    if (commander.location !== "lodge") return begin(soldier.actor);
    const deployed = simulation.deployCommander();
    if (!deployed.ok) return deployed;
    pending = { actor: soldier.actor, commander: commander.id }; notice = undefined;
    return { ok: true as const };
  };
  const afterTick = () => {
    if (disposed) return;
    if (pending) {
      const commander = simulation.commanderSnapshot();
      const actor = simulation.frames().find(row => row.uid === pending!.actor);
      if (!canEnter() || commander?.id !== pending.commander || !actor ||
        !["militaryLeaving", "militaryField"].includes(actor.phase)) {
        notice = "Commander deployment was interrupted"; pending = null; return;
      }
      if (actor.phase === "militaryField" && !simulation.commanderControlProblem(actor.uid)) begin(actor.uid);
    }
    if (generation === null) return;
    const actual = simulation.commanderControlSnapshot();
    if (!actual || actual.generation !== generation || !canEnter()) { leave(); return; }
    const tick = simulation.gameTick();
    if (tick <= lastSentTick) return;
    // Look deltas accumulated per rendered frame are sent once, quantised, by this tick.
    yaw = ((yaw + finiteClamp(yawDelta, -Math.PI, Math.PI)) % TAU + TAU) % TAU;
    pitch = finiteClamp(pitch + finiteClamp(pitchDelta, -Math.PI, Math.PI), -Math.PI * .45, Math.PI * .45);
    yawDelta = 0; pitchDelta = 0;
    // Keep the render-rate camera ahead of the body, bounded by the head/camera free-look arc.
    const lead = wrapAngle(viewYaw - yaw), maxLead = actual.mounted ? Math.PI * 110 / 180 : Math.PI;
    viewYaw = wrapAngle(yaw + finiteClamp(lead, -maxLead, maxLead));
    viewPitch = finiteClamp(viewPitch, -Math.PI * .45, Math.PI * .45);
    const input: CommanderInput = { generation, forward: Math.round(forward * 127),
      right: Math.round(right * 127), heading: Math.round(yaw / TAU * 65536) % 65536,
      pitch: Math.round(pitch / Math.PI * 32768), buttons };
    if (!simulation.submitCommanderInput(input)) { leave(); return; }
    lastSentTick = tick;
    buttons &= ~EDGE_BUTTONS;
  };
  const unsubscribe = simulation.observeTicks(afterTick);
  const setButton = (action: ButtonAction, held: boolean) => {
    if (generation === null || !actorActionEnabled("commander", action)) return false;
    const bit = COMMANDER_INPUT_BUTTON[action];
    if (held) buttons |= bit;
    // A pointer/key press may finish between rendered frames. Deliver one canonical horse action
    // before clearing its edge; continuous attack/guard still follow their actual held state.
    else if (!(bit & EDGE_BUTTONS)) buttons &= ~bit;
    return true;
  };
  const follow = (type: CommanderFollowType | "all", enabled: boolean) => {
    if (generation === null) return false;
    const suffix = type === "all" ? "All" : type[0]!.toUpperCase() + type.slice(1);
    if (!actorActionEnabled("commander", `${enabled ? "follow" : "hold"}${suffix}`)) return false;
    return simulation.setCommanderFollow(type, enabled);
  };
  return {
    enter, leave, clearInputs,
    active: () => generation !== null,
    preparing: () => pending !== null,
    notice: () => notice,
    snapshot: () => generation === null ? null : simulation.commanderControlSnapshot(),
    setMovement: (nextForward: number, nextRight: number) => {
      forward = finiteClamp(nextForward, -1, 1); right = finiteClamp(nextRight, -1, 1);
    },
    /** `nextYaw`/`nextPitch` are rad/s; the frame delta is accumulated without a rate clamp. */
    setLook: (nextYaw: number, nextPitch: number, deltaSeconds = .05) => {
      const step = Math.min(.1, Math.max(0, deltaSeconds));
      const yawStep = finiteClamp(nextYaw, -40, 40) * step, pitchStep = finiteClamp(nextPitch, -40, 40) * step;
      yawDelta += yawStep; pitchDelta += pitchStep;
      viewYaw = wrapAngle(viewYaw + yawStep);
      viewPitch = finiteClamp(viewPitch + pitchStep, -Math.PI * .45, Math.PI * .45);
    },
    /** Render-rate look: the camera runs ahead of the authoritative body by at most its free-look arc. */
    view: () => generation === null ? null : { pitch: viewPitch, yaw: viewYaw },
    setButton, follow,
    action: (action: CommanderHotkeyAction, held: boolean) => {
      if (Object.hasOwn(COMMANDER_INPUT_BUTTON, action)) return setButton(action as ButtonAction, held);
      if (!held) return false;
      for (const type of ["all", "shield", "heavy", "archer"] as const) {
        const suffix = type[0]!.toUpperCase() + type.slice(1);
        if (action === `follow${suffix}`) return follow(type, true);
        if (action === `hold${suffix}`) return follow(type, false);
      }
      return false;
    },
    assignEscort: (uids: readonly number[]) => generation === null ? [] : simulation.assignCommanderEscort(uids),
    dispose: () => { if (disposed) return; leave(); disposed = true; unsubscribe(); }
  };
};
