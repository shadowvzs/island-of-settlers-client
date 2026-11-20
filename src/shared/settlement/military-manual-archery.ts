import { MILITARY_PROFILES } from "../balance/military";
import { DMath } from "../math/deterministic-math";
import { militaryManualBowOrigin } from "./military-bow-origin";
import type { MilitaryCombatant } from "./military-combat-rules";
import { ARROW_SPEED, type MilitaryArrow } from "./military-projectiles";
import type { SettlementActor } from "./settlement-types";

/** Bounded point-shot uses the ordinary horizontal-flight solver, dispersion and swept contacts. */
export const manualBowTarget = (actor: Pick<SettlementActor, "mounted" | "x" | "y" | "yaw" | "z">,
  aim: NonNullable<MilitaryCombatant["pendingAim"]>,
  range: number) => {
  const pitch = Math.max(-Math.PI * .45, Math.min(Math.PI * .45, aim.pitch / 32768 * Math.PI));
  const origin = militaryManualBowOrigin(actor, pitch), yaw = aim.heading / 65536 * Math.PI * 2;
  const horizontal = DMath.cos(pitch) * range;
  return { x: origin.x + DMath.sin(yaw) * horizontal,
    y: origin.y + DMath.sin(pitch) * range, z: origin.z + DMath.cos(yaw) * horizontal };
};

export const cancelManualBowDraw = (state: MilitaryCombatant) => {
  if (!state.pendingAim) return;
  state.pendingAim = undefined;
  state.attackTime = 0;
};

export const manualBowDrawProblem = (combat: MilitaryCombatant, commander: boolean, phase: string) => {
  const aim = combat.pendingAim;
  if (aim === undefined) return null;
  if (!aim || typeof aim !== "object" || Array.isArray(aim) || Object.keys(aim).length !== 2 ||
    !Number.isSafeInteger(aim.heading) || aim.heading < 0 || aim.heading > 65535 ||
    !Number.isSafeInteger(aim.pitch) || Math.abs(aim.pitch) > 16384 ||
    !commander || combat.commanderLoadout !== "bow" || phase !== "militaryField" || combat.hp <= 0 ||
    !(combat.attackTime! > 0 && combat.attackTime! <= .6) || combat.pendingTarget !== undefined ||
    combat.doorBlow || combat.closeQuarters) return "Invalid manual bow draw";
  return null;
};

export const manualArrowLifetimeInvalid = (arrow: MilitaryArrow) => arrow.maximumAge !== undefined &&
  (!Number.isFinite(arrow.maximumAge) || arrow.maximumAge < .15 ||
    arrow.maximumAge > Math.max(.15, MILITARY_PROFILES.archer.range / ARROW_SPEED) + 1e-6 ||
    arrow.age > arrow.maximumAge || Boolean(arrow.boulder));
