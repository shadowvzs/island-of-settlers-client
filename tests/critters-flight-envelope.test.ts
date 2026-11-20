import { describe, expect, it } from "vitest";

import { getCritterModel } from "../src/render-common/critters/critter-models";
import { CRITTER } from "../src/render-common/critters/critter-species";
import { getCritterBirdFlightEnvelope } from "../src/render-common/critters/sim/critter-building-flight";
import type { PropMesh } from "../src/render-common/props/mesh-builder";

/** The sphere around every frame's vertices, centred at their middle height (the former runtime bake). */
const measureEnvelope = (frames: readonly PropMesh[]) => {
  let minY = Infinity, maxY = -Infinity;
  for (const frame of frames) for (let vertex = 1; vertex < frame.positions.length; vertex += 3) {
    minY = Math.min(minY, frame.positions[vertex]!); maxY = Math.max(maxY, frame.positions[vertex]!);
  }
  const height = (minY + maxY) / 2;
  let radius = 0;
  for (const frame of frames) for (let vertex = 0; vertex < frame.positions.length; vertex += 3)
    radius = Math.max(radius, Math.hypot(frame.positions[vertex]!, frame.positions[vertex + 1]! - height,
      frame.positions[vertex + 2]!));
  return { height, radius };
};

/** Frames the envelope encloses: every eagle pose, the heron and gull flight frames (8 on). */
const FLIGHT_FRAMES_FROM = { [CRITTER.eagle]: 0, [CRITTER.gull]: 8, [CRITTER.heron]: 8 };

describe("critter flight envelopes", () => {
  it("match the baked High models exactly (the simulation never loads a model)", () => {
    for (const [species, from] of Object.entries(FLIGHT_FRAMES_FROM)) {
      const frames = getCritterModel(Number(species))!.frames.slice(from);
      expect(getCritterBirdFlightEnvelope(Number(species)), species).toEqual(measureEnvelope(frames));
    }
  });

  it("has no envelope for ground critters", () => {
    expect(getCritterBirdFlightEnvelope(CRITTER.fox)).toBeUndefined();
  });
});
