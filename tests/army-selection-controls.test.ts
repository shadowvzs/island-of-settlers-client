import { describe, expect, it, vi } from "vitest";

import {
  HOTKEY_DEFAULTS, type HotkeyBindings, type HotkeyEvent, parseHotkeyBindings
} from "../src/app/settings/hotkeys/bindings";
import { createArmyControlGroups, isAboardShip } from "../src/app/settlement/army-groups/control-groups";
import { createArmyFirstUseTip } from "../src/app/settlement/army-groups/first-use-tip";
import { matchesGroupKey } from "../src/app/settlement/army-groups/group-keys";
import { createArmySelectionCommands } from "../src/app/settlement/army-groups/selection-commands";
import { getArmyCursorMode } from "../src/app/settlement/army-order-cursor";
import { getActionButtons, getArmyRailView, INITIAL_ARMY_RAIL_STATE } from "../src/app/settlement/army-rail/helpers";
import { DOUBLE_TAP_MS, DOUBLE_TAP_PIXELS, isDoubleTap, isOnScreen } from "../src/app/settlement/army-selection";
import { ARMY_HOVER_INTERVAL_MS } from "../src/app/settlement/army-target/constants";
import { type ArmyTarget, armyTargetCursor } from "../src/app/settlement/army-target/helpers";
import {
  armyTargetHoverKey, armyTargetOutline, createHoverThrottle
} from "../src/app/settlement/army-target/target-hover";
import { militaryKeyCommand, needsSelection } from "../src/app/settlement/military-hotkeys";
import type { MilitarySelection } from "../src/app/settlement/military-selection";

const bindings = parseHotkeyBindings(null);
const key = (code: string, fields: Partial<HotkeyEvent> = {}): HotkeyEvent => ({ code, ...fields });
const access = { x: 1, z: 2 };
const point = { x: 5, z: 6 };

describe("control groups (military controls §7)", () => {
  it("assigns, recalls only selectable soldiers, prunes the fallen and lists badges by digit", () => {
    const groups = createArmyControlGroups();
    groups.assign(3, [10, 11, 12]);
    groups.assign(1, [20]);
    expect(groups.badges()).toEqual([{ aboard: 0, count: 1, digit: 1 }, { aboard: 0, count: 3, digit: 3 }]);
    // A stored soldier stays in the group but is not selected while it is off the map.
    expect(groups.recall(3, id => id !== 11)).toEqual([10, 12]);
    expect(groups.prune(new Set([10, 12, 99]))).toBe(true);
    expect(groups.badges()).toEqual([{ aboard: 0, count: 2, digit: 3 }]);
    expect(groups.prune(new Set([10, 12]))).toBe(false);
    groups.assign(3, []);
    expect(groups.badges()).toEqual([]);
    expect(groups.recall(7, () => true)).toEqual([]);
  });

  it("counts members aboard a ship apart: the recall skips them and the badge marks them", () => {
    const groups = createArmyControlGroups();
    groups.assign(2, [10, 11, 12]);
    const actors = [{ uid: 10 }, { navalOrder: 0, uid: 11 }, { uid: 12 }];
    const aboard = new Set(actors.filter(isAboardShip).map(actor => actor.uid));
    expect(groups.badges(id => aboard.has(id))).toEqual([{ aboard: 1, count: 2, digit: 2 }]);
    expect(groups.recall(2, id => !aboard.has(id))).toEqual([10, 12]);
    const state = { ...INITIAL_ARMY_RAIL_STATE, groups: groups.badges(id => aboard.has(id)) };
    expect(getArmyRailView(state).groups[0]).toMatchObject({
      label: "Group 2: 2 soldiers on the map, 1 aboard a ship (not selected). Press 2 to select it, Shift+2 to assign.",
      text: "2·2 \u2693\uFE0E1"
    });
  });
});

describe("army key matching (§5.2, §8)", () => {
  it("matches digits and Shift + digits, never Ctrl / Alt / Meta, repeats or text fields", () => {
    expect(matchesGroupKey(key("Digit4"), bindings)).toEqual({ assign: false, digit: 4 });
    expect(matchesGroupKey(key("Numpad9"), bindings)).toEqual({ assign: false, digit: 9 });
    expect(matchesGroupKey(key("Digit2", { shiftKey: true }), bindings)).toEqual({ assign: true, digit: 2 });
    for (const modifier of ["ctrlKey", "altKey", "metaKey", "repeat", "defaultPrevented"] as const)
      expect(matchesGroupKey(key("Digit1", { [modifier]: true }), bindings), modifier).toBeNull();
    expect(matchesGroupKey(key("Digit0"), bindings)).toBeNull();
    expect(matchesGroupKey(key("Digit1", { target: { tagName: "INPUT" } as unknown as EventTarget }), bindings))
      .toBeNull();
  });

  it("lets a game hotkey rebound to a digit keep the plain press; possessed digits do not block", () => {
    const rebound: HotkeyBindings = { ...bindings, cinematic: "Digit5" };
    expect(matchesGroupKey(key("Digit5"), rebound)).toBeNull();
    expect(matchesGroupKey(key("Digit5", { shiftKey: true }), rebound)).toEqual({ assign: true, digit: 5 });
    expect(bindings.followShield).toBe("Digit1");
    expect(matchesGroupKey(key("Digit1"), bindings)).toEqual({ assign: false, digit: 1 });
  });

  it("maps the default army hotkeys and leaves modified letters alone", () => {
    expect(["KeyM", "KeyA", "KeyR", "KeyG", "KeyH", "Backquote", "Digit6"].map(code =>
      militaryKeyCommand(key(code), bindings))).toEqual([
      { kind: "arm", order: "move" }, { kind: "arm", order: "attack" }, { kind: "arm", order: "retreat" },
      { kind: "arm", order: "enter" }, { kind: "return" }, { kind: "selectAll" },
      { key: { assign: false, digit: 6 }, kind: "group" }
    ]);
    expect(militaryKeyCommand(key("KeyA", { shiftKey: true }), bindings)).toBeNull();
    expect(militaryKeyCommand(key("KeyA", { ctrlKey: true }), bindings)).toBeNull();
    expect(militaryKeyCommand(key("KeyZ"), bindings)).toBeNull();
    expect(needsSelection({ kind: "selectAll" })).toBe(false);
    expect(needsSelection({ kind: "return" })).toBe(true);
  });

  it("adds A / R / H / G / ` as game hotkeys without stealing saved keys", () => {
    expect(bindings).toMatchObject({ armyAttackMove: "KeyA", armyEnter: "KeyG", armyRetreat: "KeyR",
      armyReturn: "KeyH", armySelectAll: "Backquote" });
    expect(HOTKEY_DEFAULTS.armyReturn.mode).toBe("game");
    const saved: Partial<Record<string, string>> = { ...bindings, buildingNames: "KeyA", cinematic: "Backquote" };
    for (const action of ["armyAttackMove", "armyEnter", "armyRetreat", "armyReturn", "armySelectAll"])
      delete saved[action];
    const migrated = parseHotkeyBindings(JSON.stringify(saved));
    expect(migrated).toMatchObject({ armyAttackMove: "", armyEnter: "KeyG", armyRetreat: "KeyR",
      armyReturn: "KeyH", armySelectAll: "", buildingNames: "KeyA", cinematic: "Backquote" });
    // Possessed H / G (call horse, follow all) share the keys across modes without a conflict.
    expect(migrated).toMatchObject({ callHorse: "KeyH", followAll: "KeyG" });
  });

  it("shows the bound key in the rail tooltips", () => {
    const buttons = getActionButtons(INITIAL_ARMY_RAIL_STATE, { attack: "A", move: "M" });
    expect(buttons.map(button => button.title).slice(0, 3)).toEqual(["Move (M)", "Attack / attack move (A)",
      "Retreat (ignores enemies)"]);
  });
});

describe("double tap (§7)", () => {
  it("needs a second soldier tap within the time and distance window", () => {
    const first = { time: 1000, x: 100, y: 100 };
    expect(isDoubleTap(null, first)).toBe(false);
    expect(isDoubleTap(first, { time: 1000 + DOUBLE_TAP_MS, x: 100 + DOUBLE_TAP_PIXELS, y: 100 })).toBe(true);
    expect(isDoubleTap(first, { time: 1001 + DOUBLE_TAP_MS, x: 100, y: 100 })).toBe(false);
    expect(isDoubleTap(first, { time: 1100, x: 113, y: 100 })).toBe(false);
    expect(isOnScreen({ x: 10, y: 5 }, { height: 10, width: 20 })).toBe(true);
    expect(isOnScreen({ x: -1, y: 5 }, { height: 10, width: 20 })).toBe(false);
  });

  it("selects the troop type on the second tap with one recorded selection per tap", () => {
    let now = 0;
    const selection = {
      clickSelect: vi.fn(() => 7), ids: () => [], replace: vi.fn(), selectAll: vi.fn(), selectableBodies: () => [],
      selected: new Set<number>(), selectTypeOf: vi.fn(() => 4), soldierAt: vi.fn(() => 7)
    } as unknown as MilitarySelection;
    const message = vi.fn();
    const commands = createArmySelectionCommands({ message, now: () => now, onChange: vi.fn(), selection });
    expect(commands.tap({ x: 50, y: 50 }, {}, false)).toBe(true);
    now = 200;
    expect(commands.tap({ x: 52, y: 51 }, { ctrlKey: true }, false)).toBe(true);
    expect(selection.clickSelect).toHaveBeenCalledTimes(1);
    expect(selection.selectTypeOf).toHaveBeenCalledWith(7, "island", false);
    expect(message).toHaveBeenCalledWith("4 soldiers of this type selected.", false);
    now = 300;
    commands.tap({ x: 52, y: 51 }, {}, true);
    expect(selection.clickSelect, "a third tap starts a new pair").toHaveBeenCalledTimes(2);
    now = 1000;
    commands.tap({ x: 52, y: 51 }, {}, true);
    expect(selection.selectTypeOf).toHaveBeenCalledTimes(1);
  });

  it("recalls a group as one selection and says so when none of it is on the map", () => {
    const selected = new Set<number>([1, 2]);
    const selection = {
      ids: () => [...selected], replace: vi.fn(), selectableBodies: () => [{ uid: 2 }], selected
    } as unknown as MilitarySelection;
    const message = vi.fn();
    const commands = createArmySelectionCommands({ message, onChange: vi.fn(), selection });
    commands.assignGroup(1);
    expect(message).toHaveBeenLastCalledWith("Group 1: 2 soldiers.", false);
    commands.recallGroup(1);
    expect(selection.replace).toHaveBeenCalledWith([2]);
    commands.recallGroup(5);
    expect(message).toHaveBeenLastCalledWith("Group 5 has no soldier on the map.", true);
    expect(selection.replace).toHaveBeenCalledTimes(1);
  });
});

describe("target hover (P3)", () => {
  it("runs at most once per interval and evaluates the last request at its end", () => {
    let now = 0;
    const timers: { delay: number; run: () => void }[] = [];
    const throttle = createHoverThrottle(ARMY_HOVER_INTERVAL_MS, {
      clear: vi.fn(), now: () => now, set: (run, delay) => timers.push({ delay, run })
    });
    const runs: string[] = [];
    throttle.request(() => runs.push("first"));
    now = 30;
    throttle.request(() => runs.push("second"));
    throttle.request(() => runs.push("third"));
    expect(runs).toEqual(["first"]);
    expect(timers.map(timer => timer.delay)).toEqual([ARMY_HOVER_INTERVAL_MS - 30]);
    now = ARMY_HOVER_INTERVAL_MS;
    timers[0]!.run();
    expect(runs).toEqual(["first", "third"]);
    now = 2 * ARMY_HOVER_INTERVAL_MS + 1;
    throttle.request(() => runs.push("later"));
    expect(runs).toEqual(["first", "third", "later"]);
  });

  it("maps every target to its cursor, outline and change key", () => {
    const building = (kind: "hostile" | "military" | "other" | "storage") => ({ access, kind, uid: 7 });
    const targets: ArmyTarget[] = [
      { building: building("hostile"), kind: "siege" }, { kind: "board", shipId: "s1" },
      { building: building("storage"), kind: "store" }, { building: building("military"), kind: "garrison" },
      { building: building("other"), kind: "gather" }, { kind: "attackUnit", point, targetUid: 9 },
      { kind: "ground", mode: "attackMove", point }, { kind: "ground", mode: "move", point },
      { kind: "ground", mode: "retreat", point }, { kind: "noGround" }
    ];
    expect(targets.map(armyTargetCursor)).toEqual(["siege", "board", "store", "enter", "attack", "attack",
      "attack", "move", "retreat", "invalid"]);
    const fort = { buildingId: "settlement-7" };
    expect(targets.map(armyTargetOutline)).toEqual([fort, { shipId: "s1" }, fort, fort, fort, { soldierId: 9 },
      {}, {}, {}, {}]);
    expect(armyTargetHoverKey(targets[0]!)).toBe("siege|settlement-7||");
    expect(armyTargetHoverKey({ kind: "ground", mode: "move", point: { x: 9, z: 9 } }))
      .toBe(armyTargetHoverKey(targets[7]!));
    expect(armyTargetHoverKey(null)).toBe("");
  });

  it("lets a pending order and box select own the cursor before the hover target", () => {
    expect(getArmyCursorMode("retreat", true, "siege")).toBe("retreat");
    expect(getArmyCursorMode(null, true, "siege")).toBe("add");
    expect(getArmyCursorMode(null, false, "siege")).toBe("siege");
    expect(getArmyCursorMode(null, false)).toBeNull();
  });
});

describe("first-use tip (§11)", () => {
  it("shows once, at the first selection, and remembers it", () => {
    const write = vi.fn(() => true);
    const show = vi.fn();
    const tip = createArmyFirstUseTip(show, { read: () => false, write });
    tip(0);
    tip(2);
    tip(3);
    expect(show).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(true);
    const seen = vi.fn();
    createArmyFirstUseTip(seen, { read: () => true, write })(1);
    expect(seen).not.toHaveBeenCalled();
  });
});
