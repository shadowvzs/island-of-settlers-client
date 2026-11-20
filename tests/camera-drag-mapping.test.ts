import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createMouseRotationPreference, parseMouseRotation
} from "../src/app/settings/mouse-rotation/preference";
import { createCameraController } from "../src/render-common/camera-controller";
import { cameraDragDeadZone, cameraDragMode, type MouseRotation } from "../src/render-common/camera-drag-mapping";
import { createCamera } from "../src/render-common/camera-state";

const LEFT = 0, MIDDLE = 1, RIGHT = 2;

describe("mouse rotation button mapping", () => {
  it.each<[MouseRotation, number, boolean, ReturnType<typeof cameraDragMode>]>([
    ["middle", LEFT, false, "pan"], ["middle", MIDDLE, false, "rotate"], ["middle", RIGHT, false, null],
    ["right", LEFT, false, "pan"], ["right", MIDDLE, false, "rotate"], ["right", RIGHT, false, "rotate"],
    ["off", LEFT, false, "pan"], ["off", MIDDLE, false, null], ["off", RIGHT, false, null],
    // Army box mode: the left drag selects, the rotation button pans instead.
    ["middle", LEFT, true, null], ["middle", MIDDLE, true, "pan"], ["middle", RIGHT, true, null],
    ["right", RIGHT, true, "pan"], ["off", MIDDLE, true, null]
  ])("%s: button %i (box mode %s) → %s", (rotation, button, selecting, expected) => {
    expect(cameraDragMode(button, rotation, selecting)).toBe(expected);
  });

  it("holds right drags inside the tap radius only", () => {
    expect(cameraDragDeadZone(RIGHT)).toBe(6);
    expect(cameraDragDeadZone(MIDDLE)).toBe(0);
    expect(cameraDragDeadZone(LEFT)).toBe(0);
  });

  it("moves players without a stored choice (right drag used to rotate) to Middle drag", () => {
    expect(parseMouseRotation(null)).toBe("middle");
    expect(parseMouseRotation("sideways")).toBe("middle");
    expect(parseMouseRotation("right")).toBe("right");
    const persist = vi.fn(), preference = createMouseRotationPreference(null, persist);
    preference.setRotation("middle");
    expect(persist).not.toHaveBeenCalled();
    preference.setRotation("off");
    expect(persist).toHaveBeenCalledWith("off");
    expect(preference.getSnapshot()).toBe("off");
  });
});

class TestElement extends EventTarget {
  setPointerCapture() {}
}

const pointer = (type: string, button: number, x: number, y = 0) => Object.assign(new Event(type), {
  button, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse"
});

const setup = (rotation: MouseRotation) => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("HTMLElement", TestElement);
  const element = new TestElement();
  const camera = createCamera(64, 64, 1);
  const controller = createCameraController({
    camera, cellsX: 128, cellsZ: 128, element: element as unknown as HTMLElement,
    mouseRotation: () => rotation, rotateKeyTurn: code => (code === "KeyQ" ? 1 : 0),
    surface: element as unknown as HTMLElement
  });
  const drag = (button: number, distances: number[]) => {
    element.dispatchEvent(pointer("pointerdown", button, 0));
    for (const x of distances) element.dispatchEvent(pointer("pointermove", button, x));
    element.dispatchEvent(pointer("pointerup", button, distances.at(-1) ?? 0));
  };
  return { camera, controller, drag, element };
};

afterEach(() => vi.unstubAllGlobals());

describe("camera drag input", () => {
  it("never turns on a right tap with the default setting", () => {
    const { camera, controller, drag } = setup("middle");
    drag(RIGHT, [3, 40]);
    expect(camera.yaw).toBe(0);
    drag(MIDDLE, [3]);
    expect(camera.yaw).not.toBe(0);
    controller.dispose();
  });

  it("turns on a right drag only past the 6 px dead zone, without a jump", () => {
    const { camera, controller, drag } = setup("right");
    drag(RIGHT, [2, 6]);
    expect(camera.yaw).toBe(0);
    drag(RIGHT, [2, 10, 20]);
    // The drag starts at the 10 px crossing: only the following 10 px turn the view.
    expect(camera.yaw).toBeCloseTo(10 * 0.006, 6);
    controller.dispose();
  });

  it("reads the rotate hotkeys instead of fixed Q / E codes", () => {
    const { camera, controller } = setup("middle");
    const key = (type: string, code: string) =>
      window.dispatchEvent(Object.assign(new Event(type), { code }));
    key("keydown", "KeyE"); controller.update(.5); key("keyup", "KeyE");
    expect(camera.yaw).toBe(0);
    key("keydown", "KeyQ"); controller.update(.5); key("keyup", "KeyQ");
    expect(camera.yaw).toBeCloseTo(.7, 6);
    controller.dispose();
  });
});
