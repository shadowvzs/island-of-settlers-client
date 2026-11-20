import { describe, expect, it } from "vitest";

import { completedEconomyJobOutput } from "../src/app/settlement/offline-economy-production";
import { groupMetalworksProduction } from "../tools/analysis/offline-production-comparison";

const tools = new Set(["axe", "bow", "hammer"]);
const armory = new Set(["axe", "bow", "sword", "shield"]);
describe("Metalworks production acceptance", () => {
  it("treats different tool mixes with equal throughput as the same result", () => {
    const exact = groupMetalworksProduction({ axe: 3, hammer: 2 },
      [{ islandId: "home", uid: 25, typeId: 25, produced: { axe: 3, hammer: 2 } }], tools, new Set());
    const candidate = groupMetalworksProduction({ hammer: 5 },
      [{ islandId: "home", uid: 25, typeId: 25, produced: { hammer: 5 } }], tools, new Set());
    expect(candidate).toEqual(exact);
    expect(candidate).toEqual({ metalworksTools: 5 });
  });
  it("counts an output mix as total tools while preserving separate armory production", () => {
    const grouped = groupMetalworksProduction({ axe: 3, bow: 5, hammer: 2, sword: 1 },
      [{ islandId: "home", uid: 25, typeId: 25, produced: { axe: 2, bow: 1, hammer: 2 } },
        { islandId: "home", uid: 24, typeId: 24, produced: { axe: 1, bow: 4, sword: 1 } }], tools, armory);
    expect(grouped).toEqual({ axe: 1, bow: 4, sword: 1, metalworksTools: 5 });
  });
  it("rejects attribution that would hide a weapon deficit or subtract output twice", () => {
    expect(() => groupMetalworksProduction({ bow: 1 },
      [{ islandId: "home", uid: 25, typeId: 25, produced: { bow: 2 } }], tools, armory))
      .toThrow("Metalworks production attribution does not match physical output");
    expect(() => groupMetalworksProduction({ hammer: 2 }, [], tools, armory))
      .toThrow("Unattributed Metalworks output: hammer");
  });
  it("counts only completed mixed cycles and excludes synthetic tokens", () => {
    expect(completedEconomyJobOutput({ uid: "tools", islandId: "home", cycleTicks: 10,
      inputs: {}, outputs: {}, outputSequence: [{ axe: 1 }, { bow: 1 }, { hammer: 1 }] }, 2))
      .toEqual({ axe: 1, bow: 1 });
    expect(completedEconomyJobOutput({ uid: "grain", islandId: "home", cycleTicks: 10,
      inputs: {}, outputs: { grain: 1, "~source": 1 } }, 3)).toEqual({ grain: 3 });
  });
});
