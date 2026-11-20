import { Euler, Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import type { BridgeRecipeInput } from "../src/render-common/bridges/bridge-recipe";
import { addWoodBridgeLandings, landingGroundAt } from "../src/render-common/bridges/wood-bridge-recipe";
import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { crossing } from "./helpers/bridge-recipe-support";

/** Most a landing's foot may stand above its ground (a lit slit under the timber shows beyond it). */
const MAX_GAP = 0.01;
/** Least height of a landing's top over its ground (closer, the ground would flicker through it). */
const MIN_COVER = 0.015;

const landingParts = (input: BridgeRecipeInput) => {
  const parts: BuildingPart[] = [];
  addWoodBridgeLandings(input, part => parts.push(part as BuildingPart));
  return parts;
};

/** Corners of a part's box after its rotation; `bottom` picks the lower or upper face. */
const faceCorners = (part: BuildingPart, bottom: boolean) => {
  const matrix = new Matrix4().makeRotationFromEuler(new Euler(...(part.rotation ?? [0, 0, 0])));
  const cylinder = part.shape === "cylinder";
  return [-0.5, 0.5].flatMap(sx => [-0.5, 0.5].map(sz => {
    // A pole lies across: its axis is local y (turned onto z); its foot is its lowest line.
    const local = cylinder ? new Vector3(0, sz * part.size[1], (bottom ? 0.5 : -0.5) * part.size[0])
      : new Vector3(sx * part.size[0], (bottom ? -0.5 : 0.5) * part.size[1], sz * part.size[2]);
    return local.applyMatrix4(matrix).add(new Vector3(...part.position));
  }));
};

/** Road shapes: graded flush with the terrain, a ramp raised over a lower bank, a cross slope. */
const ROADS: readonly [string, (input: BridgeRecipeInput) => BridgeRecipeInput][] = [
  ["graded road", input => ({ ...input, roadAt: input.terrainAt })],
  ["ramp over a lower bank", input => ({ ...input, roadAt: (along, across) => {
    const out = Math.max(0, along <= input.length / 2 ? -along : along - input.length);
    const mouth = input.deckTopAt(along < 0 ? 0 : input.length), ground = input.terrainAt(along, across);
    return Math.max(ground, mouth - out * 0.25);
  } })],
  ["cross-sloped bank and road", input => {
    const sloped = (along: number, across: number) => input.terrainAt(along, across) + across * 0.04;
    return { ...input, roadAt: sloped, terrainAt: sloped };
  }]
];

describe("wooden bridge landings", () => {
  for (const [label, road] of ROADS)
    for (const skew of [0, 0.35])
      for (const detailed of [true, false]) {
        const lod = detailed ? "High" : "Minimal";
        it(`rest on the road at both mouths, every level (${label}, ${skew ? "angled" : "straight"}, ${lod})`, () => {
          let worstGap = -Infinity, worst = "";
          for (const level of [0, 1, 2, 3, 4]) {
            const input = road({ ...crossing(6, 0.3, detailed, skew), level });
            for (const part of landingParts(input)) {
              const sleeper = part.shape !== "cylinder";
              for (const corner of faceCorners(part, true)) {
                // A sloped board's foot edge leans a little past the mouth, over the abutment.
                if (corner.x > 0 && corner.x < input.length) continue;
                const ground = landingGroundAt(input, corner.x, corner.z);
                // Poles lie on their sleepers; boards and sleepers stand on the ground.
                if (sleeper && corner.y - ground > worstGap) {
                  worstGap = corner.y - ground;
                  worst = `level ${level + 1} ${part.shape}/${part.surface} at ${corner.x.toFixed(2)}/${corner.z.toFixed(2)}`;
                }
              }
              // Sleepers lie under the poles, below the walk line.
              if (part.surface === "wood" && sleeper) continue;
              for (const corner of faceCorners(part, false)) expect(corner.y - landingGroundAt(input, corner.x, corner.z),
                `level ${level + 1} ${part.shape} top at ${corner.x.toFixed(2)}/${corner.z.toFixed(2)}`)
                .toBeGreaterThanOrEqual(MIN_COVER);
            }
          }
          expect(worstGap, worst).toBeLessThanOrEqual(MAX_GAP);
        });
      }
});
