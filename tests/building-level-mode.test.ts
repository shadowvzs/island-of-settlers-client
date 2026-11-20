import { afterEach, describe, expect, it, vi } from "vitest";

import { createBuildingLevelMode } from "../src/app/settlement/building-level-mode";
import { buildingLevelMessage } from "../src/app/settlement/debug-tool-messages";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";

const name = (typeId: number) => `Building ${typeId}`;
const createMode = (picked: SettlementBuilding | undefined) => {
  const messages: Array<[string, boolean | undefined]> = [];
  const raised = vi.fn();
  const debugRaiseBuildingLevel = vi.fn(() => ({ level: 2, ok: true as const, typeId: 25 }));
  const mode = createBuildingLevelMode({ buildingName: name, cancelPlacement: vi.fn(),
    message: (text, warning) => messages.push([text, warning]), pickBuilding: () => picked,
    simulation: { debugRaiseBuildingLevel }, onRaised: raised });
  return { debugRaiseBuildingLevel, messages, mode, raised };
};

describe("raise building level click mode", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("raises the clicked building and turns off with Escape", () => {
    const keys = new EventTarget();
    vi.stubGlobal("window", keys);
    const { debugRaiseBuildingLevel, messages, mode, raised } = createMode({ uid: 7 } as SettlementBuilding);
    const watcher = vi.fn();
    mode.watch(watcher);
    mode.set(true);
    mode.click(10, 20);
    expect(debugRaiseBuildingLevel).toHaveBeenCalledWith(7);
    expect(raised).toHaveBeenCalledOnce();
    expect(messages.at(-1)).toEqual(["Building 25 raised to level 2.", false]);
    const escape = Object.assign(new Event("keydown"), { key: "Escape" });
    keys.dispatchEvent(escape);
    expect(mode.active()).toBe(false);
    expect(watcher.mock.calls).toEqual([[true], [false]]);
    mode.dispose();
  });

  it("warns when no building is under the cursor", () => {
    vi.stubGlobal("window", new EventTarget());
    const { debugRaiseBuildingLevel, messages, mode } = createMode(undefined);
    mode.click(0, 0);
    expect(debugRaiseBuildingLevel).not.toHaveBeenCalled();
    expect(messages).toEqual([["No building under the cursor.", true]]);
  });

  it("names the building in refusals", () => {
    expect(buildingLevelMessage({ ok: false, reason: "already at its maximum level 5", typeId: 33 }, name))
      .toEqual({ text: "Building 33: already at its maximum level 5.", warning: true });
  });
});
