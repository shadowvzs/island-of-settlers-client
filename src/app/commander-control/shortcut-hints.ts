import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { actorActionEnabled } from "../../render-common/workers/actor-action-capabilities";
import { COMMANDER_HOTKEY_ACTIONS, type HotkeyBindings } from "../settings/hotkeys/bindings";

const SHORT = {
  attack: msg({ id: "commander.hints.attack", message: "Attack" }),
  block: msg({ id: "commander.hints.block", message: "Block" }),
  dismount: msg({ id: "commander.hints.dismount", message: "Dismount" }),
  callHorse: msg({ id: "commander.hints.horse", message: "Call horse" }),
  followAll: msg({ id: "commander.hints.followAll", message: "All: follow" }),
  holdAll: msg({ id: "commander.hints.holdAll", message: "All: hold" }),
  followShield: msg({ id: "commander.hints.followShield", message: "Shields: follow" }),
  holdShield: msg({ id: "commander.hints.holdShield", message: "Shields: hold" }),
  followHeavy: msg({ id: "commander.hints.followHeavy", message: "Heavy: follow" }),
  holdHeavy: msg({ id: "commander.hints.holdHeavy", message: "Heavy: hold" }),
  followArcher: msg({ id: "commander.hints.followArcher", message: "Archers: follow" }),
  holdArcher: msg({ id: "commander.hints.holdArcher", message: "Archers: hold" })
};
export const getCommanderHintRows = (bindings: HotkeyBindings, actor: string, i18n: I18n) =>
  COMMANDER_HOTKEY_ACTIONS.filter(action => actorActionEnabled(actor, action) && bindings[action]).map(action => ({
    id: action, keys: [bindings[action]], label: i18n._(SHORT[action])
  }));
export const HINTS_LABEL = msg({ id: "possessed.hints.toggle", message: "Hints" });
