import { describe, expect, it } from "vitest";

import { GROUND_VARIANT_GLSL } from "../src/render-common/shaders/ground-variants-glsl";
import { TRAFFIC_PAVED_GROOVE_GLSL, TRAFFIC_RUT_GLSL } from "../src/render-common/shaders/traffic-wear-glsl";
import {
  createTrafficWearSource,
  TRAFFIC_WEAR_CHANNELS,
  TRAFFIC_WEAR_LINE_CHANNEL,
  TRAFFIC_WEAR_TUNING,
  type TrafficWearCart
} from "../src/render-common/traffic-wear";
import { blendTrailLine, decodeLineAngle, decodeLineOffset } from "../src/render-common/traffic-wear-lines";
import type { RoadSegment, RoadTier } from "../src/shared/settlement/road-types";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";
import type { WorldData } from "../src/shared/world/world-data";

const WORLD_CELLS = 16;
const world = { cellsX: WORLD_CELLS, cellsZ: WORLD_CELLS } as WorldData;
const { add, decay, decayEveryUpdates, updateTicks } = TRAFFIC_WEAR_TUNING;

const actor = (x: number, z: number, action = "walk", uid = 1): SettlementActor => ({
  action, handcart: undefined, uid, visible: true, x, z
} as unknown as SettlementActor);

const sourceFor = (actors: SettlementActor[], segments: RoadSegment[] = [], carts: TrafficWearCart[] = []) => {
  let listener = () => {};
  const source = createTrafficWearSource({
    frames: () => actors,
    observeTicks: callback => { listener = callback; return () => { listener = () => {}; }; }
  }, world, { revision: 1, segments: () => segments }, () => carts);
  const runUpdates = (count: number) => {
    for (let step = 0; step < count * updateTicks; step++) listener();
  };
  return { runUpdates, source, tick: () => listener() };
};

const texelByte = (x: number, z: number, channel: number) => (z * WORLD_CELLS + x) * TRAFFIC_WEAR_CHANNELS + channel;
const ground = (pixels: Uint8Array, x: number, z: number) => pixels[texelByte(x, z, 0)]!;
const rut = (pixels: Uint8Array, x: number, z: number) => pixels[texelByte(x, z, 1)]!;
/** Decoded trail line of a texel: direction and signed offset from its centre (undefined = none). */
const lineAt = (pixels: Uint8Array, x: number, z: number) => {
  const byte = texelByte(x, z, TRAFFIC_WEAR_LINE_CHANNEL);
  if (!pixels[byte + 1]) return undefined;
  return { angle: decodeLineAngle(pixels[byte]!), offset: decodeLineOffset(pixels[byte + 1]!) };
};
const sum = (pixels: Uint8Array, channel: number) =>
  pixels.reduce((total, value, index) => index % TRAFFIC_WEAR_CHANNELS === channel ? total + value : total, 0);

/** A straight east-west road along z = 8 (on the half-cell road grid) across the world. */
const road = (tier: RoadTier): RoadSegment[] => Array.from({ length: WORLD_CELLS * 2 }, (_, index) => ({
  end: { x: (index + 1) / 2, z: 8 }, start: { x: index / 2, z: 8 }, tier
}));

/** Registers the walkers, moves them east to `x`, then runs one more update. */
const walkEast = (walkers: SettlementActor[], segments: RoadSegment[], x: number) => {
  const run = sourceFor(walkers, segments);
  run.runUpdates(1);
  for (const walker of walkers) walker.x = x;
  run.runUpdates(1);
  return run.source.pixels;
};

describe("traffic wear source", () => {
  it("draws a continuous off-road trail on the update cadence", () => {
    const walker = actor(1.2, 3.5);
    const { runUpdates, source, tick } = sourceFor([walker]);
    runUpdates(1);
    expect(sum(source.pixels, 0)).toBe(0);
    walker.x = 4.6;
    for (let step = 0; step < updateTicks - 1; step++) tick();
    expect(sum(source.pixels, 0)).toBe(0);
    tick();
    for (const x of [2, 3, 4]) expect(ground(source.pixels, x, 3)).toBe(add);
    expect(ground(source.pixels, 1, 3)).toBe(0);
    expect(sum(source.pixels, 1)).toBe(0);
  });

  it("wears nothing for idle, hidden or standing actors", () => {
    const idle = actor(3.2, 3.2, "idle", 1), hidden = { ...actor(5.2, 5.2, "walk", 2), visible: false };
    const standing = actor(7.2, 7.2, "walk", 3);
    const { runUpdates, source } = sourceFor([idle, hidden, standing]);
    runUpdates(1);
    idle.x = 4.4; hidden.x = 6.4;
    runUpdates(3);
    expect(sum(source.pixels, 0)).toBe(0);
  });

  it("never lets walkers write ruts or stripes on a dirt road", () => {
    const pixels = walkEast([actor(2.2, 8.1)], road("dirt"), 6.2);
    expect(sum(pixels, 0) + sum(pixels, 1)).toBe(0);
  });

  it("stores the walked line, so the shader places footprints on the real trail", () => {
    const pixels = walkEast([actor(1.2, 3.3)], [], 4.6);
    const line = lineAt(pixels, 3, 3)!;
    expect(line.angle).toBeLessThan(0.01);
    expect(line.offset).toBeCloseTo(-0.2, 1);
  });

  it("cuts ruts only at the two real wheel contacts of a moving hand cart", () => {
    const cart = { id: 9, x: 2.2, z: 8 };
    const run = sourceFor([], road("dirt"), [cart]);
    run.runUpdates(1);
    cart.x = 6.2;
    run.runUpdates(1);
    const pixels = run.source.pixels, gauge = TRAFFIC_WEAR_TUNING.wheelHalfGauge;
    expect(rut(pixels, 4, Math.floor(8 - gauge))).toBe(add);
    expect(rut(pixels, 4, Math.floor(8 + gauge))).toBe(add);
    expect(sum(pixels, 0)).toBe(0);
    // Both wheel texels rebuild the same centre line (z = 8), whatever their own centre.
    expect(lineAt(pixels, 4, 7)!.offset).toBeCloseTo(0.5, 1);
    expect(lineAt(pixels, 4, 8)!.offset).toBeCloseTo(-0.5, 1);
  });

  it("marks both real wheel contacts on paved roads for faint grooves", () => {
    const cart = { id: 9, x: 2.2, z: 8 };
    const run = sourceFor([], road("stone"), [cart]);
    run.runUpdates(1);
    cart.x = 6.2;
    run.runUpdates(1);
    const pixels = run.source.pixels, gauge = TRAFFIC_WEAR_TUNING.wheelHalfGauge;
    expect(rut(pixels, 4, Math.floor(8 - gauge))).toBe(add);
    expect(rut(pixels, 4, Math.floor(8 + gauge))).toBe(add);
    expect(sum(pixels, 0)).toBe(0);
  });

  it("uses the two real wheel contacts on both dirt ruts and paved grooves", () => {
    for (const shader of [TRAFFIC_RUT_GLSL, TRAFFIC_PAVED_GROOVE_GLSL]) {
      expect(shader).toContain("trafficWheelTrack(line");
    }
    expect(TRAFFIC_PAVED_GROOVE_GLSL).toContain("trafficPavedGrooveShade");
  });

  it("parked carts and carts on bridges cut no cart wear", () => {
    const parked = { id: 1, x: 3.2, z: 8 }, onBridge = { id: 2, x: 2.2, z: 8 };
    const bridge = road("stone").map(segment => ({
      ...segment,
      bridge: { id: 1, kind: "stone" as const, tile: 0, tiles: 1, width: 2.6 }
    }));
    const run = sourceFor([], bridge, [parked, onBridge]);
    run.runUpdates(1);
    onBridge.x = 6.2;
    run.runUpdates(2);
    expect(sum(run.source.pixels, 1)).toBe(0);
  });

  it("does not wear paved roads from walkers or the verge beside a dirt road", () => {
    const paved = walkEast([actor(2.2, 8.1)], road("stone"), 6.2);
    expect(sum(paved, 0) + sum(paved, 1)).toBe(0);
    const verge = walkEast([actor(2.2, 8.9)], road("dirt"), 6.2);
    expect(sum(verge, 0) + sum(verge, 1)).toBe(0);
  });

  it("decays slowly to zero, caps a busy texel and stays deterministic", () => {
    const walker = actor(1.2, 3.5);
    const { runUpdates, source } = sourceFor([walker]);
    runUpdates(1);
    for (let pass = 0; pass < 30; pass++) { walker.x = pass % 2 ? 1.2 : 3.4; runUpdates(1); }
    expect(ground(source.pixels, 2, 3)).toBe(255);
    walker.action = "idle";
    runUpdates(decayEveryUpdates - 1);
    expect(ground(source.pixels, 2, 3)).toBeGreaterThan(255 - 2 * decay);
    runUpdates(decayEveryUpdates * Math.ceil(255 / decay));
    expect(sum(source.pixels, 0)).toBe(0);
    const first = sourceFor([actor(1.2, 3.5)]), second = sourceFor([actor(1.2, 3.5)]);
    first.runUpdates(5); second.runUpdates(5);
    expect(first.source.pixels).toEqual(second.source.pixels);
    expect(first.source.revision).toBe(second.source.revision);
  });
});

describe("snow traffic wear", () => {
  it("uses cool grey-white snow tints, never earth brown", () => {
    const { snowPacked, snowPrint, snowRim } = TRAFFIC_WEAR_TUNING;
    for (const tint of [snowPrint, snowPacked, snowRim]) {
      expect(tint[2]).toBeGreaterThan(tint[1]!);
      expect(tint[1]).toBeGreaterThan(tint[0]);
    }
  });

  it("blends the full and lite ground wear by snow coverage", () => {
    const full = GROUND_VARIANT_GLSL.full, lite = GROUND_VARIANT_GLSL.lite;
    expect(full).toContain("snowShare + forestShare * winter");
    expect(full).toContain("applyTrafficPrints(applyTrafficWear(albedo, tread.x, snowCover)");
    expect(full).toContain("trafficPrintSlope(dFdx(prints), dFdy(prints), worldDx, worldDy)");
    expect(full).toMatch(/tread\.y, snowCover,\s+worldDx\.xz, worldDy\.xz/);
    expect(full).toContain("snowCover <= 0.001");
    expect(lite).toContain("float snowCover = clamp(weightB.z, 0.0, 1.0)");
    expect(lite).toContain("applyTrafficWear(albedo, wear, snowCover)");
  });
});

describe("traffic wear trail lines", () => {
  const sample = (heading: number, z: number) => ({ byte: 0, centreX: 0.5, centreZ: 0.5, heading, x: 0.5, z });

  it("keeps an established line against a crossing trail and blends a close one", () => {
    const pixels = new Uint8Array(2);
    blendTrailLine(pixels, sample(0, 0.7), false);
    blendTrailLine(pixels, sample(Math.PI / 2, 0.5), true);
    expect(decodeLineAngle(pixels[0]!)).toBeLessThan(0.02);
    blendTrailLine(pixels, sample(0, 0.3), true);
    expect(decodeLineOffset(pixels[1]!)).toBeCloseTo(0.2 * 0.75 - 0.2 * 0.25, 1);
  });

  it("treats opposite headings as the same line", () => {
    const pixels = new Uint8Array(2);
    blendTrailLine(pixels, sample(0, 0.7), false);
    blendTrailLine(pixels, sample(Math.PI, 0.7), true);
    expect(decodeLineAngle(pixels[0]!)).toBeLessThan(0.02);
    expect(decodeLineOffset(pixels[1]!)).toBeCloseTo(0.2, 1);
  });
});
