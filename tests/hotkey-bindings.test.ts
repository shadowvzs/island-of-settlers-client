import { describe, expect, it, vi } from "vitest";

import {
  cameraRotateTurn, createHotkeySettings, formatHotkeyCode, hotkeyEventAllowed, parseHotkeyBindings,
  possessedActionForCode
} from "../src/app/settings/hotkeys/bindings";

const event = { code: "KeyN", target: null };

describe("saved player hotkeys", () => {
  it("saves accepted bindings, reloads them, and restores defaults", () => {
    const persist = vi.fn(), settings = createHotkeySettings(null, persist);
    expect(settings.rebind("buildingNames", "KeyB")).toEqual({ kind: "accepted" });
    expect(settings.rebind("forward", "KeyW")).toEqual({ kind: "accepted" });
    const restored = parseHotkeyBindings(persist.mock.lastCall![0]);
    expect(restored).toMatchObject({ buildingNames: "KeyB", forward: "KeyW", backward: "ArrowDown" });
    settings.reset();
    expect(settings.getSnapshot()).toMatchObject({ buildingNames: "KeyN", forward: "ArrowUp" });
  });

  it("rejects same-mode conflicts atomically and permits reuse across modes", () => {
    const persist = vi.fn(), settings = createHotkeySettings(null, persist);
    const before = settings.getSnapshot();
    expect(settings.rebind("buildingNames", "KeyC")).toEqual({ action: "cinematic", kind: "conflict" });
    expect(settings.getSnapshot()).toBe(before);
    expect(persist).not.toHaveBeenCalled();
    expect(settings.rebind("spyglass", "KeyN")).toEqual({ kind: "accepted" });
    expect(settings.rebind("forward", "ArrowDown")).toEqual({ action: "backward", kind: "conflict" });
  });

  it("keeps the global clean-view key clear of every mode", () => {
    const settings = createHotkeySettings(null, vi.fn());
    expect(settings.getSnapshot().hideHud).toBe("KeyU");
    expect(settings.rebind("hideHud", "KeyN")).toEqual({ action: "buildingNames", kind: "conflict" });
    expect(settings.rebind("hideHud", "KeyZ")).toEqual({ action: "spyglass", kind: "conflict" });
    expect(settings.rebind("attack", "KeyU")).toEqual({ action: "hideHud", kind: "conflict" });
    expect(settings.rebind("hideHud", "KeyB")).toEqual({ kind: "accepted" });
    expect(possessedActionForCode("KeyB", settings.getSnapshot())).toBeUndefined();
  });

  it("keeps Escape as emergency Back and removes default zoom aliases after rebinding", () => {
    const settings = createHotkeySettings(null, vi.fn());
    expect(settings.rebind("forward", "Escape")).toEqual({ kind: "reserved" });
    expect(settings.rebind("back", "KeyV")).toEqual({ kind: "accepted" });
    expect(possessedActionForCode("Escape", settings.getSnapshot())).toBe("back");
    expect(possessedActionForCode("KeyV", settings.getSnapshot())).toBe("back");
    expect(possessedActionForCode("NumpadAdd", settings.getSnapshot())).toBe("zoomIn");
    settings.rebind("zoomIn", "KeyI");
    expect(possessedActionForCode("NumpadAdd", settings.getSnapshot())).toBeUndefined();
    expect(possessedActionForCode("KeyI", settings.getSnapshot())).toBe("zoomIn");
  });

  it("falls back safely on corrupt, reserved or conflicting stored data", () => {
    const defaults = parseHotkeyBindings(null);
    for (const stored of ["{", "null", "[]", '{}', JSON.stringify({ ...defaults, forward: "Tab" }),
      JSON.stringify({ ...defaults, forward: "ArrowDown" })])
      expect(parseHotkeyBindings(stored)).toEqual(defaults);
  });

  it("introduces Space jump without resetting prior preferences or stealing a held movement binding", () => {
    const old: Partial<Record<string, string>> = { ...parseHotkeyBindings(null), buildingNames: "KeyB", forward: "KeyW" };
    delete old.possessedJump;
    expect(parseHotkeyBindings(JSON.stringify(old))).toMatchObject({ buildingNames: "KeyB", forward: "KeyW", possessedJump: "Space" });
    old.forward = "Space";
    const retained = parseHotkeyBindings(JSON.stringify(old));
    expect(retained).toMatchObject({ buildingNames: "KeyB", forward: "Space", possessedJump: "" });
    expect(possessedActionForCode("Space", retained)).toBe("forward");
    expect(possessedActionForCode("", retained)).toBeUndefined();
  });

  it("ignores typing, composition, repeated toggles and modified browser shortcuts", () => {
    expect(hotkeyEventAllowed(event)).toBe(true);
    for (const changes of [{ repeat: true }, { isComposing: true }, { ctrlKey: true }, { altKey: true },
      { metaKey: true }, { shiftKey: true }, { defaultPrevented: true },
      { target: { tagName: "INPUT" } }, { target: { tagName: "SELECT" } },
      { target: { isContentEditable: true } }])
      expect(hotkeyEventAllowed({ ...event, ...changes } as never)).toBe(false);
    expect(formatHotkeyCode("KeyN")).toBe("N");
    expect(formatHotkeyCode("ArrowUp")).toBe("↑");
    expect(formatHotkeyCode("Digit1")).toBe("1");
  });

  it("keeps previously saved commander keys available to their original action", () => {
    const old = { back: "KeyX", forward: "KeyE" };
    const restored = parseHotkeyBindings(JSON.stringify(old));
    expect(restored.back).toBe("KeyX"); expect(restored.dismount).toBe("");
    expect(restored.forward).toBe("KeyE"); expect(restored.attack).toBe("");
  });

  it("moves the camera Q / E keys into the bindings without stealing saved keys", () => {
    const defaults = parseHotkeyBindings(null);
    expect(defaults).toMatchObject({ armyMove: "KeyM", cameraRotateLeft: "KeyQ", cameraRotateRight: "KeyE" });
    expect([cameraRotateTurn("KeyQ", defaults), cameraRotateTurn("KeyE", defaults),
      cameraRotateTurn("KeyW", defaults), cameraRotateTurn("", defaults)]).toEqual([1, -1, 0, 0]);
    // A player who put building names on Q before the camera keys were bindable keeps Q for them.
    const old: Partial<Record<string, string>> = { ...defaults, buildingNames: "KeyQ", cinematic: "KeyM" };
    for (const action of ["armyMove", "cameraRotateLeft", "cameraRotateRight"]) delete old[action];
    const migrated = parseHotkeyBindings(JSON.stringify(old));
    expect(migrated).toMatchObject({ armyMove: "", buildingNames: "KeyQ", cameraRotateLeft: "",
      cameraRotateRight: "KeyE", cinematic: "KeyM" });
    expect(cameraRotateTurn("KeyQ", migrated)).toBe(0);
    // Possessed commander keys share Q / E across modes without a conflict.
    expect(migrated).toMatchObject({ attack: "KeyE", block: "KeyQ" });
    const settings = createHotkeySettings(null, vi.fn());
    expect(settings.rebind("cameraRotateLeft", "KeyN")).toEqual({ action: "buildingNames", kind: "conflict" });
    expect(settings.rebind("cameraRotateLeft", "KeyZ")).toEqual({ kind: "accepted" });
    expect(cameraRotateTurn("KeyZ", settings.getSnapshot())).toBe(1);
  });
});
