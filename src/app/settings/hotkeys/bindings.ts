import { createExternalStore } from "../../components/ui-store";
import { rawTextCodec } from "../../preferences/codecs";
import { PREFERENCES } from "../../preferences/keys";
import { definePreference } from "../../preferences/registry";

export const HOTKEY_DEFAULTS = {
  buildingNames: { code: "KeyN", mode: "game" },
  cinematic: { code: "KeyC", mode: "game" },
  hideHud: { code: "KeyU", mode: "global" },
  /** Formerly hard-coded camera keys, now visible to the conflict check (military controls P0). */
  cameraRotateLeft: { code: "KeyQ", mode: "game" },
  cameraRotateRight: { code: "KeyE", mode: "game" },
  /** Soldier orders (military controls §5.2): arm an order for the next map click, or act at once. */
  armyMove: { code: "KeyM", mode: "game" },
  armyAttackMove: { code: "KeyA", mode: "game" },
  armyRetreat: { code: "KeyR", mode: "game" },
  armyReturn: { code: "KeyH", mode: "game" },
  armyEnter: { code: "KeyG", mode: "game" },
  armySelectAll: { code: "Backquote", mode: "game" },
  forward: { code: "ArrowUp", mode: "possessed" },
  backward: { code: "ArrowDown", mode: "possessed" },
  attack: { code: "KeyE", mode: "possessed" },
  block: { code: "KeyQ", mode: "possessed" },
  toggleHotkeys: { code: "KeyK", mode: "possessed" },
  dismount: { code: "KeyX", mode: "possessed" },
  callHorse: { code: "KeyH", mode: "possessed" },
  followAll: { code: "KeyG", mode: "possessed" },
  holdAll: { code: "KeyT", mode: "possessed" },
  followShield: { code: "Digit1", mode: "possessed" },
  holdShield: { code: "Digit2", mode: "possessed" },
  followHeavy: { code: "Digit3", mode: "possessed" },
  holdHeavy: { code: "Digit4", mode: "possessed" },
  followArcher: { code: "Digit5", mode: "possessed" },
  holdArcher: { code: "Digit6", mode: "possessed" },
  possessedJump: { code: "Space", mode: "possessed" },
  turnLeft: { code: "ArrowLeft", mode: "possessed" },
  turnRight: { code: "ArrowRight", mode: "possessed" },
  spyglass: { code: "KeyZ", mode: "possessed" },
  fullscreen: { code: "KeyF", mode: "possessed" },
  zoomIn: { code: "Equal", mode: "possessed" },
  zoomOut: { code: "Minus", mode: "possessed" },
  back: { code: "Escape", mode: "possessed" }
} as const;

export type HotkeyAction = keyof typeof HOTKEY_DEFAULTS;
export const COMMANDER_HOTKEY_ACTIONS = ["attack", "block", "dismount", "callHorse", "followAll", "holdAll",
  "followShield", "holdShield", "followHeavy", "holdHeavy", "followArcher", "holdArcher"] as const;
export type CommanderHotkeyAction = typeof COMMANDER_HOTKEY_ACTIONS[number];
export const isCommanderHotkeyAction = (action: unknown): action is CommanderHotkeyAction =>
  typeof action === "string" && (COMMANDER_HOTKEY_ACTIONS as readonly string[]).includes(action);
export type HotkeyBindings = Readonly<Record<HotkeyAction, string>>;
const storedHotkeys = definePreference(PREFERENCES.hotkeys, rawTextCodec);
export const HOTKEY_ACTIONS = Object.keys(HOTKEY_DEFAULTS) as HotkeyAction[];
const defaultBindings = (): HotkeyBindings => Object.fromEntries(
  HOTKEY_ACTIONS.map(action => [action, HOTKEY_DEFAULTS[action].code])
) as Record<HotkeyAction, string>;

/** Single physical keys avoid OS/browser modifier shortcuts and keep held movement unambiguous. */
const CHARACTER_KEY = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Up|Down|Left|Right))$/;
const OTHER_KEYS = new Set(["Space", "Minus", "Equal", "NumpadAdd", "NumpadSubtract", "BracketLeft",
  "BracketRight", "Backquote", "Semicolon", "Quote", "Comma", "Period", "Slash", "Backslash",
  "Home", "End", "PageUp", "PageDown", "Insert", "Delete", "Backspace"]);
export const isBindableCode = (code: string) => CHARACTER_KEY.test(code) || OTHER_KEYS.has(code);

/** Global actions work in every mode, so they share their key with no action of any mode. */
const modesOverlap = (first: HotkeyAction, second: HotkeyAction) => {
  const firstMode: string = HOTKEY_DEFAULTS[first].mode, secondMode: string = HOTKEY_DEFAULTS[second].mode;
  return firstMode === secondMode || firstMode === "global" || secondMode === "global";
};

export const findHotkeyConflict = (bindings: HotkeyBindings, action: HotkeyAction, code: string) =>
  code && HOTKEY_ACTIONS.find(other => other !== action && modesOverlap(other, action) && bindings[other] === code);

export const parseHotkeyBindings = (stored: string | null): HotkeyBindings => {
  const defaults = defaultBindings();
  if (!stored) return defaults;
  try {
    const candidate: unknown = JSON.parse(stored);
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return defaults;
    const next = { ...defaults };
    for (const action of HOTKEY_ACTIONS) {
      const code: unknown = (candidate as Record<string, unknown>)[action];
      if (code === undefined) continue;
      if (typeof code !== "string" || !(code === "" || isBindableCode(code) || action === "back" && code === "Escape"))
        return defaults;
      next[action] = code;
    }
    for (const action of HOTKEY_ACTIONS) {
      const conflict = findHotkeyConflict(next, action, next[action]);
      if (!conflict) continue;
      const saved = candidate as Record<string, unknown>;
      if (saved[action] !== undefined && saved[conflict] !== undefined) return defaults;
      // Newly introduced actions must not wipe existing preferences or steal a saved key.
      if (saved[action] === undefined) next[action] = "";
      else next[conflict] = "";
    }
    return next;
  } catch {
    return defaults;
  }
};

export const createHotkeySettings = (stored: string | null, persist: (value: string) => void) => {
  const store = createExternalStore(parseHotkeyBindings(stored));
  const publish = (next: HotkeyBindings) => {
    persist(JSON.stringify(next));
    store.set(next);
  };
  return {
    ...store,
    rebind: (action: HotkeyAction, code: string) => {
      if (!(code === "" || isBindableCode(code) || action === "back" && code === "Escape"))
        return { kind: "reserved" } as const;
      const conflict = findHotkeyConflict(store.getSnapshot(), action, code);
      if (conflict) return { action: conflict, kind: "conflict" } as const;
      publish({ ...store.getSnapshot(), [action]: code });
      return { kind: "accepted" } as const;
    },
    reset: () => publish(defaultBindings())
  };
};

/** Local preferences stay outside simulation/save/replay state, just like sound and graphics. */
export const hotkeySettings = createHotkeySettings(
  storedHotkeys.read(), value => { storedHotkeys.write(value); }
);

export interface HotkeyEvent {
  altKey?: boolean;
  code: string;
  ctrlKey?: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
  shiftKey?: boolean;
  target?: EventTarget | null;
}

export const hotkeyEventAllowed = (event: HotkeyEvent, allowRepeat = false) => {
  const target = event.target as { isContentEditable?: boolean; tagName?: string } | null;
  return !event.defaultPrevented && !event.isComposing && (allowRepeat || !event.repeat) &&
    !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey &&
    !target?.isContentEditable && !/^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "");
};

export const matchesHotkey = (action: HotkeyAction, event: HotkeyEvent, allowRepeat = false) =>
  Boolean(event.code) && hotkeyEventAllowed(event, allowRepeat) && hotkeySettings.getSnapshot()[action] === event.code;

/** Camera turn of a held key: 1 for rotate left, -1 for rotate right, 0 for any other key. */
export const cameraRotateTurn = (code: string, bindings = hotkeySettings.getSnapshot()) => {
  if (!code) return 0;
  if (bindings.cameraRotateLeft === code) return 1;
  return bindings.cameraRotateRight === code ? -1 : 0;
};

/** Existing numeric-pad zoom aliases follow the defaults; rebinding replaces them as well. */
export const possessedActionForCode = (code: string, bindings = hotkeySettings.getSnapshot()) => {
  if (!code) return undefined;
  if (code === "Escape") return "back";
  const action = HOTKEY_ACTIONS.find(item => HOTKEY_DEFAULTS[item].mode === "possessed" && bindings[item] === code);
  if (action) return action;
  if (code === "NumpadAdd" && bindings.zoomIn === "Equal") return "zoomIn";
  if (code === "NumpadSubtract" && bindings.zoomOut === "Minus") return "zoomOut";
  return undefined;
};

export const formatHotkeyCode = (code: string) => {
  if (!code) return "—";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const labels: Record<string, string> = {
    ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", Backquote: "`",
    Backslash: "\\", BracketLeft: "[", BracketRight: "]", Comma: ",", Equal: "+ / =",
    Escape: "Esc", Minus: "−", Period: ".", Quote: "'", Semicolon: ";", Slash: "/"
  };
  return labels[code] ?? code.replace(/^Numpad/, "Num ").replace(/([a-z])([A-Z])/g, "$1 $2");
};
