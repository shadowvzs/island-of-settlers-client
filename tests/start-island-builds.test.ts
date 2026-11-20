import { describe, expect, it, vi } from "vitest";

import type { ContentBuilders } from "../src/render-common/content-builders";
import { QUALITY_PRESETS } from "../src/render-common/quality";
import { startIslandBuilds } from "../src/render-common/start-island-builds";

const createBuilders = () => ({
  coverField: vi.fn(async () => ({ height: 0, pixels: new Uint8Array(), width: 0 })),
  fieldCover: vi.fn(async () => ({ count: 7 })),
  islandRocks: vi.fn(async () => ({})),
  terrainChunks: vi.fn(async () => []),
  waterField: vi.fn(async () => ({}))
}) as unknown as ContentBuilders & {
  coverField: ReturnType<typeof vi.fn>;
  fieldCover: ReturnType<typeof vi.fn>;
};

describe("start island builds", () => {
  it("builds the field cover at the preset density where grass is drawn", async () => {
    const builders = createBuilders();
    const { coverFieldBuild, grassBuild } = startIslandBuilds(builders, QUALITY_PRESETS.high);
    expect(builders.coverField).toHaveBeenCalledTimes(1);
    expect(await coverFieldBuild).toEqual({ height: 0, pixels: new Uint8Array(), width: 0 });
    expect(builders.fieldCover).toHaveBeenCalledWith(QUALITY_PRESETS.high.grassSamples);
    expect((await grassBuild).count).toBe(7);
  });

  it("builds the cheap two-sample field cover on Minimal", async () => {
    const builders = createBuilders();
    const { coverFieldBuild, grassBuild } = startIslandBuilds(builders, QUALITY_PRESETS.minimal);
    expect(builders.coverField).toHaveBeenCalledTimes(1);
    await coverFieldBuild;
    expect(builders.fieldCover).toHaveBeenCalledWith(QUALITY_PRESETS.minimal.grassSamples);
    expect((await grassBuild).count).toBe(7);
  });
});
