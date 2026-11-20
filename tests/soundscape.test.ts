import { describe, expect, it } from "vitest";

import {
  computeLayerMix,
  getCreatureCallRate,
  getCricketGain,
  getDawnChorus,
  getForestBirdsongGain,
  getGust,
  getZoomLevel,
  SOUND_FEATURES,
  type SoundConditions,
  type SoundSample
} from "../src/app/audio/soundscape-mix";
import { makeLoop, measurePeak, measureRms, normalize } from "../src/app/audio/synth/dsp";
import { LOOP_LAYERS, renderCallVariants, renderLoop } from "../src/app/audio/synth/sound-bank";
import { countEvents, getSpatialCall } from "../src/app/audio/wildlife-voices";
import {
  createSoundField,
  removeSoundTree,
  sampleSoundField,
  viewToWorld,
  worldToView
} from "../src/app/audio/world-sound-field";
import {
  DEFAULT_ENVIRONMENT_VOLUME,
  formatSoundLayers,
  parseSoundLayers,
  parseVolume
} from "../src/app/settings/sound-settings";
import { createCamera } from "../src/render-common/camera-state";
import { getTreeSpecies } from "../src/render-common/props/island-trees";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { createRandom } from "../src/shared/world/rng";
import { cachedWorld } from "./helpers/cached-worlds";

const NO_PAN = Object.fromEntries(
  SOUND_FEATURES.map((feature) => [feature, 0])
) as SoundSample["pan"];

const sample = (features: Partial<Omit<SoundSample, "pan">>): SoundSample => ({
  broadleaf: 0,
  meadow: 0,
  pan: NO_PAN,
  palm: 0,
  pine: 0,
  river: 0,
  riverSpeed: 0,
  sea: 0,
  shore: 0,
  ...features
});

const DAY: SoundConditions = { daylight: 1, hour: 12, rain: 0, snow: 0, wind: 0.9, zoom: 1.5 };
const DAWN: SoundConditions = { ...DAY, hour: 7 };
const NIGHT: SoundConditions = { ...DAY, daylight: 0, hour: 23 };
const ALL_ON = new Set<never>();

const FOREST = sample({ broadleaf: 0.5, pine: 0.1 });
const MEADOW = sample({ meadow: 0.8 });

describe("soundscape layer mix", () => {
  it("plays surf near the coast and open sea swell, no river", () => {
    const coast = computeLayerMix(sample({ sea: 0.4, shore: 0.15 }), DAY, ALL_ON).gains;
    const inland = computeLayerMix(MEADOW, DAY, ALL_ON).gains;
    expect(coast.seaBreakers).toBeGreaterThan(0.7);
    expect(coast.seaSwell).toBeGreaterThan(0.5);
    expect(coast.river).toBe(0);
    expect(inland.seaBreakers + inland.seaSwell).toBe(0);
  });

  it("plays the river near rivers, louder for fast water", () => {
    const slow = computeLayerMix(sample({ river: 0.08, riverSpeed: 0 }), DAY, ALL_ON).gains;
    const fast = computeLayerMix(sample({ river: 0.08, riverSpeed: 1 }), DAY, ALL_ON).gains;
    expect(slow.river).toBeGreaterThan(0.4);
    expect(fast.river).toBeGreaterThan(slow.river);
    expect(slow.seaBreakers).toBe(0);
  });

  it("mixes the leaves by tree species", () => {
    const pines = computeLayerMix(sample({ pine: 0.3 }), DAY, ALL_ON).gains;
    const oaks = computeLayerMix(sample({ broadleaf: 0.35 }), DAY, ALL_ON).gains;
    const palms = computeLayerMix(sample({ palm: 0.12 }), DAY, ALL_ON).gains;
    expect(pines.pine).toBeGreaterThan(0.5);
    expect(pines.broadleaf + pines.palm).toBe(0);
    expect(oaks.broadleaf).toBeGreaterThan(oaks.pine + oaks.palm);
    expect(palms.palm).toBeGreaterThan(palms.broadleaf + palms.pine);
  });

  it("rustles the leaves more in stronger wind, and gusts stay 0..1", () => {
    const calm = computeLayerMix(FOREST, DAY, ALL_ON).gains.broadleaf;
    const storm = computeLayerMix(FOREST, { ...DAY, wind: 2.1 }, ALL_ON).gains.broadleaf;
    expect(storm).toBeGreaterThan(calm);
    for (let time = 0; time < 200; time += 0.7) {
      const gust = getGust(time, 2.1);
      expect(gust).toBeGreaterThanOrEqual(0);
      expect(gust).toBeLessThanOrEqual(1);
    }
  });

  it("scales the rain with its intensity, rain on leaves only under trees", () => {
    const dry = computeLayerMix(FOREST, DAY, ALL_ON).gains;
    const drizzle = computeLayerMix(FOREST, { ...DAY, rain: 0.3 }, ALL_ON).gains;
    const pour = computeLayerMix(FOREST, { ...DAY, rain: 1 }, ALL_ON).gains;
    const open = computeLayerMix(MEADOW, { ...DAY, rain: 1 }, ALL_ON).gains;
    expect(dry.rain + dry.rainLeaves).toBe(0);
    expect(pour.rain).toBeGreaterThan(drizzle.rain);
    expect(pour.rainLeaves).toBeGreaterThan(drizzle.rainLeaves);
    expect(pour.rainLeaves).toBeGreaterThan(open.rainLeaves);
    expect(open.rainLeaves).toBe(0);
  });

  it("plays the quiet snowfall bed instead of the rain when it snows", () => {
    const dry = computeLayerMix(FOREST, DAY, ALL_ON).gains;
    const light = computeLayerMix(FOREST, { ...DAY, snow: 0.3 }, ALL_ON).gains;
    const heavy = computeLayerMix(FOREST, { ...DAY, snow: 1 }, ALL_ON).gains;
    expect(dry.snowfall).toBe(0);
    expect(heavy.rain + heavy.rainLeaves).toBe(0);
    expect(heavy.snowfall).toBeGreaterThan(light.snowfall);
    expect(computeLayerMix(FOREST, { ...DAY, rain: 1 }, ALL_ON).gains.snowfall).toBe(0);
    const off = computeLayerMix(FOREST, { ...DAY, snow: 1 }, new Set(["rain"] as const));
    expect(off.gains.snowfall).toBe(0);
    expect(getCricketGain(MEADOW, { ...NIGHT, snow: 1 })).toBe(0);
    const calm = getForestBirdsongGain(FOREST, DAWN);
    expect(getForestBirdsongGain(FOREST, { ...DAWN, snow: 1 })).toBeLessThan(calm * 0.6);
  });

  it("renders the snowfall bed much quieter than the rain", () => {
    const snow = renderLoop("snowfall", 8000);
    const rain = renderLoop("rain", 8000);
    expect(measureRms(snow)).toBeLessThan(measureRms(rain) * 0.5);
    expect(measurePeak(snow)).toBeLessThan(0.5);
    expect(snow[0]).toBeCloseTo(snow.at(-1)!, 1);
  });

  it("brings crickets to meadows at night only", () => {
    expect(getCricketGain(MEADOW, NIGHT)).toBeGreaterThan(0.8);
    expect(getCricketGain(MEADOW, DAY)).toBe(0);
    expect(getCricketGain(sample({ sea: 1 }), NIGHT)).toBe(0);
    expect(getCricketGain(MEADOW, { ...NIGHT, rain: 1 })).toBe(0);
  });

  it("switches layers off", () => {
    const off = new Set(["water", "trees", "rain", "wildlife"] as const);
    const mix = computeLayerMix(sample({ broadleaf: 0.5, river: 0.1, sea: 0.5 }), NIGHT, off);
    expect(Object.values(mix.gains).every((gain) => gain === 0)).toBe(true);
    expect(mix.forestBirdsong).toBe(0);
  });

  it("is softer zoomed out", () => {
    expect(getZoomLevel(0.2)).toBeLessThan(getZoomLevel(1.5));
    expect(getZoomLevel(3)).toBe(1);
  });
});

describe("forest birdsong bed", () => {
  it("sings in forests, not in meadows", () => {
    expect(getForestBirdsongGain(FOREST, DAWN)).toBeGreaterThan(0.8);
    expect(getForestBirdsongGain(MEADOW, DAWN)).toBe(0);
  });

  it("peaks at dawn, is quieter at midday and silent at night", () => {
    expect(getDawnChorus(7)).toBe(1);
    expect(getDawnChorus(13)).toBeLessThan(getDawnChorus(7));
    expect(getDawnChorus(19)).toBeLessThan(getDawnChorus(13));
    expect(getForestBirdsongGain(FOREST, NIGHT)).toBe(0);
    expect(getForestBirdsongGain(FOREST, { ...DAY, hour: 2 })).toBe(0);
  });

  it("hushes in rain", () => {
    const dry = getForestBirdsongGain(FOREST, DAWN);
    const drizzle = getForestBirdsongGain(FOREST, { ...DAWN, rain: 0.3 });
    const pour = getForestBirdsongGain(FOREST, { ...DAWN, rain: 1 });
    expect(drizzle).toBeLessThan(dry);
    expect(pour).toBeLessThan(dry * 0.2);
  });
});

describe("creature calls", () => {
  it("calls only with creatures in view, birds quiet at night, mammals rare", () => {
    expect(getCreatureCallRate("songbird", 0, DAY)).toBe(0);
    expect(getCreatureCallRate("songbird", 3, DAY)).toBeGreaterThan(0);
    expect(getCreatureCallRate("songbird", 3, NIGHT)).toBe(0);
    expect(getCreatureCallRate("deer", 3, DAY)).toBeLessThan(
      getCreatureCallRate("songbird", 3, DAY)
    );
  });

  it("counts Poisson events around the expected rate", () => {
    const random = createRandom(5);
    let total = 0;
    for (let tick = 0; tick < 4000; tick += 1) total += countEvents(random, 2, 0.25);
    expect(total / 1000).toBeCloseTo(2, 0);
  });

  it("pans by the screen position and is louder near the target", () => {
    expect(getSpatialCall(10, 0, 10, 8).pan).toBe(1);
    expect(getSpatialCall(-5, 0, 10, 8).pan).toBe(-0.5);
    expect(getSpatialCall(0, 0, 10, 8).closeness).toBeGreaterThan(
      getSpatialCall(9, 9, 10, 8).closeness
    );
  });
});

describe("world sound field", () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, seed: 1234 });
  const field = createSoundField(world);
  const listen = (x: number, z: number, yaw = 0) => {
    const camera = createCamera(x, z, 1.5);
    camera.viewportWidth = 1600;
    camera.viewportHeight = 900;
    camera.yaw = yaw;
    return { camera, heard: sampleSoundField(field, camera) };
  };

  it("hears open sea off the island and land features inland", () => {
    const sea = listen(4, 4).heard;
    expect(sea.sea).toBeGreaterThan(0.9);
    expect(sea.broadleaf + sea.pine + sea.palm + sea.river).toBeLessThan(0.02);
  });

  it("hears a river next to river water", () => {
    const stride = world.cellsX + 1;
    let vertex = 0;
    while (!(
      world.waterDepth[vertex]! > 0 &&
      world.flow[vertex * 2] !== 0 &&
      world.heights[vertex]! > 1
    ))
      vertex += 1;
    const heard = listen(vertex % stride, Math.floor(vertex / stride)).heard;
    expect(heard.river).toBeGreaterThan(0.03);
  });

  it("converts view axes both ways, also with a rotated camera", () => {
    const { camera } = listen(60, 60, 0.7);
    const point = viewToWorld(camera, 7, -3);
    const back = worldToView(camera, point.x, point.z);
    expect(back.u).toBeCloseTo(7);
    expect(back.v).toBeCloseTo(-3);
  });

  it("pans by the camera yaw: turned half round, the coast swaps sides", () => {
    const front = listen(31, 104).heard;
    const turned = listen(31, 104, Math.PI).heard;
    expect(Math.abs(front.pan.sea)).toBeGreaterThan(0.1);
    expect(turned.pan.sea).toBeCloseTo(-front.pan.sea, 1);
  });
  it("stops the leaves of felled trees rustling (decrement = rebuilt without them)", () => {
    const felledField = createSoundField(world);
    // Generated home timber is pine/palm (owner 2026-10-18), so the felled stand is pines.
    const pines: number[] = [];
    for (let tree = 0; tree < world.props.count && pines.length < 12; tree += 1) {
      if (getTreeSpecies(world.props.types[tree]!) === "pine") pines.push(tree);
    }
    const block = (tree: number) =>
      Math.floor(world.props.z[tree]! / 4) * felledField.blocksX +
      Math.floor(world.props.x[tree]! / 4);
    const before = felledField.channels.pine[block(pines[0]!)]!;
    for (const tree of pines) removeSoundTree(felledField, world, tree);
    expect(felledField.channels.pine[block(pines[0]!)]!).toBeLessThan(before);
    const types = world.props.types.slice();
    const notTree = Array.from({ length: 256 }, (_, type) => type).find(
      (type) => getTreeSpecies(type) === undefined
    )!;
    for (const tree of pines) types[tree] = notTree;
    const rebuilt = createSoundField({ ...world, props: { ...world.props, types } });
    for (const channel of ["broadleaf", "palm", "pine"] as const) {
      felledField.channels[channel].forEach((value, index) =>
        expect(value).toBeCloseTo(rebuilt.channels[channel][index]!, 5)
      );
    }
  });
});

describe("synthesis", () => {
  it("loops seamlessly (crossfaded tail) and limits peaks", () => {
    const samples = new Float32Array(3000).map((_, index) => Math.sin(index * 0.1) * 5);
    const loop = makeLoop(samples, 0.1, 1000);
    expect(loop.length).toBe(2900);
    expect(measurePeak(normalize(loop, 0.5, 0.9))).toBeLessThanOrEqual(0.9);
  });

  it("renders every bed audible, finite and below clipping", () => {
    for (const layer of LOOP_LAYERS) {
      const samples = renderLoop(layer, 8000);
      expect(samples.every(Number.isFinite), layer).toBe(true);
      expect(measureRms(samples), layer).toBeGreaterThan(0.03);
      expect(measurePeak(samples), layer).toBeLessThan(1);
    }
  });

  it("renders varied songbird phrases", () => {
    const variants = renderCallVariants("songbird", 16000);
    const lengths = new Set(variants.map((variant) => variant.length));
    expect(lengths.size).toBeGreaterThan(variants.length / 2);
    for (const variant of variants) expect(measurePeak(variant)).toBeLessThanOrEqual(0.81);
  });
});

describe("sound settings", () => {
  it("parses the stored volume with a moderate default", () => {
    expect(parseVolume(null)).toBe(DEFAULT_ENVIRONMENT_VOLUME);
    expect(parseVolume("35")).toBe(0.35);
    expect(parseVolume("250")).toBe(1);
    expect(parseVolume("abc")).toBe(DEFAULT_ENVIRONMENT_VOLUME);
  });

  it("round trips the switched off layers and ignores unknown names", () => {
    const layers = parseSoundLayers("rain,bogus,wildlife");
    expect([...layers].sort()).toEqual(["rain", "wildlife"]);
    expect(formatSoundLayers(layers)).toBe("rain,wildlife");
    expect(parseSoundLayers(null).size).toBe(0);
  });
});
