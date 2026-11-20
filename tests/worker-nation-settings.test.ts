import { afterEach, describe, expect, it, vi } from "vitest";

import { settingsStorage } from "../src/app/settings/graphics-settings";

afterEach(() => vi.unstubAllGlobals());
describe("worker nation preference", () => {
  it("remembers each nation and defaults to Roman for missing or invalid values", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    });
    expect(settingsStorage.readWorkerNation()).toBe("roman");
    for (const nation of ["roman", "viking", "japanese", "nubian", "indigenous", "chinese", "persian", "maya"] as const) {
      settingsStorage.writeWorkerNation(nation);
      expect(settingsStorage.readWorkerNation()).toBe(nation);
    }
    values.set("island-of-settlers.worker-nation", "unknown");
    expect(settingsStorage.readWorkerNation()).toBe("roman");
  });

  it("still works when browser storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      }
    });
    expect(settingsStorage.readWorkerNation()).toBe("roman");
    expect(() => settingsStorage.writeWorkerNation("japanese")).not.toThrow();
  });
});
