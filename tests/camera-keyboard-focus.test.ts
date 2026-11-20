import { afterEach, describe, expect, it, vi } from "vitest";

import { createCameraController } from "../src/render-common/camera-controller";
import { createCamera } from "../src/render-common/camera-state";

class TestElement extends EventTarget {
  isContentEditable = false;
  constructor(readonly tagName = "CANVAS") { super(); }
}

const setup = () => {
  const windowTarget = new EventTarget();
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("HTMLElement", TestElement);
  const surface = new TestElement();
  const camera = createCamera(64, 64, 1);
  const controller = createCameraController({
    camera, cellsX: 128, cellsZ: 128,
    element: surface as unknown as HTMLElement, surface: surface as unknown as HTMLElement
  });
  const key = (type: string, target: TestElement, prevented = false) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, { code: { value: "ArrowDown" }, target: { value: target } });
    if (prevented) event.preventDefault();
    windowTarget.dispatchEvent(event);
  };
  return { camera, controller, key, surface, windowTarget };
};

afterEach(() => vi.unstubAllGlobals());

describe("camera keyboard focus", () => {
  it("keeps equipment selects, settings inputs and editable text from moving the camera", () => {
    const { camera, controller, key } = setup();
    for (const tag of ["SELECT", "INPUT", "TEXTAREA", "DIV"]) {
      const target = new TestElement(tag); target.isContentEditable = tag === "DIV";
      key("keydown", target); controller.update(.1);
      expect([camera.centerX, camera.centerZ]).toEqual([64, 64]);
      key("keyup", target);
    }
    controller.dispose();
  });

  it("honours handled keys and stops a held map key when focus moves or the window blurs", () => {
    const { camera, controller, key, surface, windowTarget } = setup();
    key("keydown", surface, true); controller.update(.1);
    expect([camera.centerX, camera.centerZ]).toEqual([64, 64]);
    for (const event of ["focusin", "blur"]) {
      key("keydown", surface); controller.update(.1);
      expect(camera.centerX).not.toBe(64);
      const position = [camera.centerX, camera.centerZ];
      windowTarget.dispatchEvent(new Event(event)); controller.update(.1);
      expect([camera.centerX, camera.centerZ]).toEqual(position);
    }
    controller.dispose();
  });
});
