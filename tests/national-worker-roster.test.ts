import { describe, expect, it, vi } from "vitest";

vi.mock("@workers/tripo-roster", async importOriginal => {
  const original = await importOriginal<typeof import("@workers/tripo-roster")>();
  const additions = Object.fromEntries(["chinese", "persian", "maya", "indigenous"].map(nation =>
    [nation, Object.fromEntries(["female", "male"].map(gender =>
      [gender, [1, 2, 3].map(variant => `${nation}-${gender}-${variant}`)]))]));
  return { ...original, TRIPO_ROSTER: { ...original.TRIPO_ROSTER, ...additions } };
});

import { hasPlayerAvatarBody, playerAvatarBody } from "../src/render-common/workers/player-avatar";
import { listFallbackBodies, randomWorkerAppearances } from "../src/render-common/workers/worker-appearance";
import { workerBodyNation } from "../src/render-common/workers/worker-body-nation";
import { resolveExplorationAppearance } from "../src/renderers/three/exploration/exploration-portrait";

describe("publishing national worker bodies", () => {
  it.each(["chinese", "persian", "maya", "indigenous"] as const)(
    "selects all six %s bodies with both genders and its own fallback list", nation => {
      const appearances = randomWorkerAppearances(6, nation, () => .4);
      expect(new Set(appearances.map(body => body.variant)).size).toBe(6);
      expect(appearances.every(body => body.nation === nation && body.variant.startsWith(nation))).toBe(true);
      expect(appearances.filter(body => body.variant.includes("female"))).toHaveLength(3);
      const fallback = listFallbackBodies({ nation, variant: `${nation}-male-1` });
      expect(fallback).toHaveLength(5);
      expect(fallback.every(variant => variant.startsWith(nation))).toBe(true);
      expect(playerAvatarBody(nation, "female").variant).toBe(`${nation}-female-1`);
    }
  );

  it("preserves explicit legacy Roman body choices and their original equipment owner", () => {
    expect(workerBodyNation("maya", "roman-man-white")).toBe("roman");
    expect(hasPlayerAvatarBody("maya", "roman-man-white", "male")).toBe(true);
    expect(resolveExplorationAppearance({ nation: "maya", body: "roman-man-white" }).appearance)
      .toEqual({ nation: "maya", variant: "roman-man-white" });
    expect(workerBodyNation("maya", "maya-male-1")).toBe("maya");
  });
});
