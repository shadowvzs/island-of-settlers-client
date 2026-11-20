import { afterEach, describe, expect, it, vi } from "vitest";

import { screenshotFileName } from "../src/app/screenshot/capture";
import { createScreenshotInput } from "../src/app/screenshot/input";

afterEach(() => vi.unstubAllGlobals());

describe("screenshot file name", () => {
  it("uses the local date and time without a prefix", () => {
    expect(screenshotFileName(new Date(2026, 10, 13, 20, 5, 9))).toBe("2026-11-13_20-05-09.png");
  });

  it("pads the month, day, hour, minute and second", () => {
    expect(screenshotFileName(new Date(2026, 0, 2, 3, 4, 5))).toBe("2026-01-02_03-04-05.png");
  });
});

describe("screenshot shortcut", () => {
  it("requests one capture for plain F9 and ignores modified or other keys", () => {
    const listeners = new Map<string, EventListener>();
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type)
    });
    const request = vi.fn();
    const input = createScreenshotInput(request);
    const onKeyDown = listeners.get("keydown")!;
    const plain = { code: "F9", preventDefault: vi.fn(), target: null } as unknown as KeyboardEvent;
    onKeyDown(plain);
    expect(request).toHaveBeenCalledOnce();
    expect(plain.preventDefault).toHaveBeenCalledOnce();
    onKeyDown({ code: "F9", ctrlKey: true, target: null } as unknown as KeyboardEvent);
    onKeyDown({ code: "F10", target: null } as unknown as KeyboardEvent);
    expect(request).toHaveBeenCalledOnce();
    input.dispose();
    expect(listeners.has("keydown")).toBe(false);
  });
});
