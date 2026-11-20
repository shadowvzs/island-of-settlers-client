import type { I18n } from "@lingui/core";

import { displayNationName, displayWareName, translateDomainText } from "../../../shared/i18n/domain";
import { translateMessage } from "../../../shared/i18n/translate";
import type { CommanderRecruitAvailability, CommanderSnapshot } from "../../../shared/settlement/settlement-commander";
import { commanderPortrait } from "../../settlement/army-icons";
import { getWareIconSource } from "../inventory";
import { SETTLEMENT_MESSAGES as M } from "../messages";

export const commanderRoleText = (commander: Pick<CommanderSnapshot, "definition">, i18n?: I18n) =>
  commander.definition.role === "offensive"
    ? translateMessage(i18n, M.details.commander.roleOffensive)
    : translateMessage(i18n, M.details.commander.roleDefensive);

export const commanderStyleText = (commander: Pick<CommanderSnapshot, "definition">, i18n?: I18n) =>
  commander.definition.style === "ranged"
    ? translateMessage(i18n, M.details.commander.styleRanged)
    : translateMessage(i18n, M.details.commander.styleMelee);

export const commanderLoadoutText = (commander: Pick<CommanderSnapshot, "definition">, i18n?: I18n) => {
  const messages = {
    axe: M.details.commander.loadoutAxe,
    bow: M.details.commander.loadoutBow,
    sword: M.details.commander.loadoutSword
  };
  return translateMessage(i18n, messages[commander.definition.loadout]);
};

export const commanderAuraText = (commander: Pick<CommanderSnapshot, "aura">, i18n?: I18n) => {
  const messages = {
    arrowReduction: M.details.commander.auraRoman,
    bowDamage: M.details.commander.auraNubian,
    meleeDamage: M.details.commander.auraViking,
    meleeDodge: M.details.commander.auraJapanese
  };
  return translateMessage(i18n, messages[commander.aura.kind]);
};

const statusText = (commander: CommanderSnapshot, i18n?: I18n) => {
  const destination = commander.transport?.destinationName ?? commander.destinationName;
  if (commander.blockReason === "awaiting-evacuation")
    return translateMessage(i18n, M.details.commander.statusAwaitingEvacuation);
  if (commander.blockReason === "awaiting-home")
    return translateMessage(i18n, M.details.commander.statusAwaitingHome);
  if (commander.blockReason === "missing-home")
    return translateMessage(i18n, M.details.commander.statusAwaitingHome);
  if (commander.location === "travelling")
    return translateMessage(i18n, M.details.commander.statusAwaitingEvacuation);
  if (commander.location === "incapacitated")
    return translateMessage(i18n, M.details.commander.statusIncapacitated);
  if (commander.blockReason === "assigned")
    return destination
      ? translateMessage(i18n, M.details.commander.statusMustering, { destination })
      : translateMessage(i18n, M.details.commander.statusAssigned);
  if (commander.blockReason === "away")
    return destination
      ? translateMessage(i18n, M.details.commander.statusDeployed, { destination })
      : translateMessage(i18n, M.details.commander.statusAssigned);
  if (commander.blockReason === "recovering")
    return translateMessage(i18n, M.details.commander.statusRecovering, {
      minutes: String(Math.ceil(commander.recoverySeconds / 60))
    });
  if (commander.blockReason === "too-injured")
    return translateMessage(i18n, M.details.commander.statusTooInjured);
  return translateMessage(i18n, M.details.commander.statusReady);
};

const xpText = (commander: CommanderSnapshot, i18n?: I18n) => commander.nextThreshold === null
  ? translateMessage(i18n, M.details.commander.maximumLevel)
  : translateMessage(i18n, M.details.commander.xpProgress, {
    next: String(commander.nextThreshold), xp: String(commander.xp)
  });

const recruitRows = (recruit: CommanderRecruitAvailability, i18n?: I18n) =>
  Object.entries(recruit.cost).map(([ware, need]) => ({
    count: String(need),
    icon: getWareIconSource(ware),
    label: `${need} ${displayWareName(ware, i18n)}`,
    name: displayWareName(ware, i18n),
    ware
  }));

const missingText = (recruit: CommanderRecruitAvailability, i18n?: I18n) => {
  const entries = Object.entries(recruit.missing);
  if (!entries.length) return null;
  return translateMessage(i18n, M.details.commander.missing, {
    items: entries.map(([ware, count]) => `${count} ${displayWareName(ware, i18n)}`).join(", ")
  });
};

export const getCommanderView = (
  commander: CommanderSnapshot | undefined, recruit: CommanderRecruitAvailability | undefined,
  nation: string, i18n?: I18n
) => {
  if (!commander) {
    return {
      aura: "",
      available: false,
      blockReason: null,
      canLevelUp: false,
      costRows: recruit ? recruitRows(recruit, i18n) : [],
      deckText: "",
      developmentAllowed: recruit?.hasCommander ? false : Boolean(recruit),
      empty: true,
      heading: translateMessage(i18n, M.details.commander.heading),
      hpFraction: 0,
      hpRequirementText: null,
      hpText: "",
      idleSettlers: recruit
        ? translateMessage(i18n, M.details.commander.idleSettlers, { count: String(recruit.idleSettlers) })
        : "",
      levelMarks: "",
      levelText: "",
      loadout: "",
      missingText: recruit ? missingText(recruit, i18n) : null,
      name: "",
      portrait: commanderPortrait(nation),
      reason: recruit?.reason ? translateDomainText(recruit.reason, i18n) : null,
      recruitAvailable: recruit?.available ?? false,
      recoveryText: "",
      role: "",
      status: "",
      style: "",
      xpText: ""
    };
  }
  const maximum = commander.maximumHp;
  const healthReady = commander.healthReady;
  return {
    aura: commanderAuraText(commander, i18n),
    available: commander.ready,
    blockReason: commander.blockReason,
    canLevelUp: commander.developmentAllowed && commander.level < 3,
    costRows: [],
    deckText: translateMessage(i18n, M.details.commander.deckSlots, { slots: String(commander.deckSlots) }),
    developmentAllowed: commander.developmentAllowed,
    empty: false,
    heading: translateMessage(i18n, M.details.commander.heading),
    hpFraction: commander.hpFraction,
    hpText: translateMessage(i18n, M.details.commander.hp, {
      current: String(Math.ceil(commander.hp)), maximum: String(Math.ceil(maximum))
    }),
    hpRequirementText: healthReady ? null : translateMessage(i18n, M.details.commander.hpReady, {
      required: String(Math.ceil(maximum * .5))
    }),
    idleSettlers: "",
    levelMarks: "▲".repeat(commander.level),
    levelText: translateMessage(i18n, M.details.commander.level, { level: String(commander.level) }),
    loadout: commanderLoadoutText(commander, i18n),
    missingText: null,
    name: commander.name,
    portrait: commanderPortrait(commander.definition.icon),
    reason: null,
    recruitAvailable: false,
    recoveryText: commander.recoveryComplete
      ? translateMessage(i18n, M.details.commander.recoveryComplete)
      : translateMessage(i18n, M.details.commander.statusRecovering, {
        minutes: String(Math.ceil(commander.recoverySeconds / 60))
      }),
    role: `${displayNationName(commander.nation, i18n)} · ${commanderRoleText(commander, i18n)}`,
    status: statusText(commander, i18n),
    style: commanderStyleText(commander, i18n),
    xpText: xpText(commander, i18n)
  };
};

export type CommanderView = ReturnType<typeof getCommanderView>;
