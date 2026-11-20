export interface AtlasMip {
  data: Uint8Array;
  height: number;
  width: number;
}

export interface AtlasRegion {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface AtlasMipOptions {
  /** Hard alpha cutoff of the colour pass; exact zero/one coverage is preserved. */
  alphaThreshold?: number;
  /** Cap on generated levels after level 0 (defaults to the smallest region's safe depth). */
  maxLevels?: number;
  /** Normal maps average RGB and renormalize instead of alpha-testing coverage. */
  mode?: "coverage" | "alpha-test" | "normal";
  /**
   * `alpha-test` only: share (0..1/3) of the gap from the averaged to the largest child alpha that a
   * texel keeps. A one-texel stem or frond (two of four children) then stays above the cutoff at
   * the next level instead of breaking into dots, while a lone child texel (one of four) still
   * drops. With it set, the base coverage is restored only where a level fell below it.
   */
  thinFeatureKeep?: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const scaledRegion = (region: AtlasRegion, level: number): AtlasRegion => {
  const scale = 2 ** level;
  return {
    height: Math.max(1, Math.ceil(region.height / scale)),
    width: Math.max(1, Math.ceil(region.width / scale)),
    x: Math.floor(region.x / scale),
    y: Math.floor(region.y / scale)
  };
};

const limitRegion = (region: AtlasRegion, width: number, height: number): AtlasRegion => {
  const x = Math.min(region.x, width - 1);
  const y = Math.min(region.y, height - 1);
  return {
    height: Math.max(1, Math.min(region.height, height - y)),
    width: Math.max(1, Math.min(region.width, width - x)),
    x,
    y
  };
};

const getCoverage = (
  data: Uint8Array,
  width: number,
  region: AtlasRegion,
  threshold: number
) => {
  let covered = 0;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      if (data[(y * width + x) * 4 + 3]! / 255 >= threshold) covered += 1;
    }
  }
  return covered / Math.max(1, region.width * region.height);
};

const restoreCoverage = (
  data: Uint8Array,
  width: number,
  region: AtlasRegion,
  target: number,
  threshold: number
) => {
  if (target <= 0 || target >= 1) {
    const alpha = target >= 1 ? 255 : 0;
    for (let y = region.y; y < region.y + region.height; y += 1) {
      for (let x = region.x; x < region.x + region.width; x += 1) {
        data[(y * width + x) * 4 + 3] = alpha;
      }
    }
    return;
  }
  let low = 0.1;
  let high = 8;
  for (let step = 0; step < 14; step += 1) {
    const scale = (low + high) * 0.5;
    let covered = 0;
    for (let y = region.y; y < region.y + region.height; y += 1) {
      for (let x = region.x; x < region.x + region.width; x += 1) {
        const index = (y * width + x) * 4 + 3;
        if (Math.min(1, (data[index]! / 255) * scale) >= threshold) covered += 1;
      }
    }
    if (covered / Math.max(1, region.width * region.height) < target) low = scale;
    else high = scale;
  }
  // Use the smallest scale that reached the target; the midpoint can round a covered texel to 127,
  // just below the 0.5 cutoff.
  const scale = high;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const index = (y * width + x) * 4 + 3;
      data[index] = Math.round(clamp((data[index]! / 255) * scale, 0, 1) * 255);
    }
  }
};

const normalizeRgb = (data: Uint8Array, offset: number) => {
  const x = data[offset]! / 127.5 - 1;
  const y = data[offset + 1]! / 127.5 - 1;
  const z = data[offset + 2]! / 127.5 - 1;
  const length = Math.hypot(x, y, z) || 1;
  data[offset] = Math.round((x / length * 0.5 + 0.5) * 255);
  data[offset + 1] = Math.round((y / length * 0.5 + 0.5) * 255);
  data[offset + 2] = Math.round((z / length * 0.5 + 0.5) * 255);
};

const sampleBlock = (
  source: Uint8Array,
  sourceWidth: number,
  sourceRegion: AtlasRegion,
  sourceX: number,
  sourceY: number
) => {
  let red = 0, green = 0, blue = 0, alpha = 0, count = 0, peak = 0;
  for (let dy = 0; dy < 2; dy += 1) {
    for (let dx = 0; dx < 2; dx += 1) {
      const px = sourceX + dx, py = sourceY + dy;
      if (px < sourceRegion.x || py < sourceRegion.y ||
          px >= sourceRegion.x + sourceRegion.width ||
          py >= sourceRegion.y + sourceRegion.height) continue;
      const offset = (py * sourceWidth + px) * 4;
      const weight = source[offset + 3]!;
      red += source[offset]! * weight;
      green += source[offset + 1]! * weight;
      blue += source[offset + 2]! * weight;
      alpha += weight;
      count += 1;
      peak = Math.max(peak, weight);
    }
  }
  return { alpha, blue, count, green, peak, red };
};

const downsampleRegion = (
  source: Uint8Array,
  sourceWidth: number,
  sourceRegion: AtlasRegion,
  target: Uint8Array,
  targetWidth: number,
  targetRegion: AtlasRegion,
  mode: NonNullable<AtlasMipOptions["mode"]>,
  thinFeatureKeep: number
) => {
  for (let y = 0; y < targetRegion.height; y += 1) {
    for (let x = 0; x < targetRegion.width; x += 1) {
      const block = sampleBlock(
        source, sourceWidth, sourceRegion, sourceRegion.x + x * 2, sourceRegion.y + y * 2
      );
      const targetOffset = ((targetRegion.y + y) * targetWidth + targetRegion.x + x) * 4;
      if (block.alpha > 0) {
        target[targetOffset] = Math.round(block.red / block.alpha);
        target[targetOffset + 1] = Math.round(block.green / block.alpha);
        target[targetOffset + 2] = Math.round(block.blue / block.alpha);
      }
      const average = block.alpha / Math.max(1, block.count);
      target[targetOffset + 3] = Math.round(average + (block.peak - average) * thinFeatureKeep);
      if (mode === "normal" && target[targetOffset + 3]! > 0) {
        normalizeRgb(target, targetOffset);
      }
    }
  }
};

/**
 * Region-aware mip chain for texture atlases. Regions are reduced independently so a coarse
 * level cannot pull a neighbouring sprite into a leaf; colour mips average coverage-weighted RGB
 * and `alpha-test` restores each region's base coverage at its hard cutoff.
 */
export const buildAtlasMips = (
  source: Uint8Array,
  width: number,
  height: number,
  regions: readonly AtlasRegion[],
  options: AtlasMipOptions = {}
): AtlasMip[] => {
  const mode = options.mode ?? "coverage";
  const threshold = options.alphaThreshold ?? 0.5;
  const thinFeatureKeep = mode === "alpha-test" ? options.thinFeatureKeep ?? 0 : 0;
  const clipped = regions
    .map(region => ({
      height: Math.min(region.height, height - region.y),
      width: Math.min(region.width, width - region.x),
      x: Math.max(0, region.x),
      y: Math.max(0, region.y)
    }))
    .filter(region => region.width > 0 && region.height > 0);
  const smallest = Math.min(...clipped.map(region => Math.min(region.width, region.height)), width, height);
  const safeLevels = Math.max(0, Math.floor(Math.log2(Math.max(1, smallest))) - 1);
  const levelCount = Math.min(options.maxLevels ?? 6, safeLevels);
  const baseCoverage = clipped.map(region => getCoverage(source, width, region, threshold));
  const mips: AtlasMip[] = [{ data: source, height, width }];
  let previous = source;
  let previousWidth = width;
  let previousHeight = height;
  for (let level = 1; level <= levelCount; level += 1) {
    const mipWidth = Math.max(1, Math.floor(width / 2 ** level));
    const mipHeight = Math.max(1, Math.floor(height / 2 ** level));
    const data = new Uint8Array(mipWidth * mipHeight * 4);
    clipped.forEach((region, index) => {
      const sourceRegion = limitRegion(scaledRegion(region, level - 1), previousWidth, previousHeight);
      const targetRegion = limitRegion(scaledRegion(region, level), mipWidth, mipHeight);
      downsampleRegion(
        previous, previousWidth, sourceRegion, data, mipWidth, targetRegion, mode, thinFeatureKeep
      );
      if (mode !== "alpha-test") return;
      const target = baseCoverage[index]!;
      if (thinFeatureKeep > 0 && getCoverage(data, mipWidth, targetRegion, threshold) >= target) return;
      restoreCoverage(data, mipWidth, targetRegion, target, threshold);
    });
    mips.push({ data, height: mipHeight, width: mipWidth });
    previous = data;
    previousWidth = mipWidth;
    previousHeight = mipHeight;
    if (previousWidth <= 1 || previousHeight <= 1) break;
  }
  return mips;
};
