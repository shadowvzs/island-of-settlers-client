import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

/**
 * Pixel parity of two 8-bit RGB/RGBA PNGs (the review tools' `toDataURL` shots). Prints changed
 * pixels, the largest and the mean channel delta; the frame's own noise floor is measured the same
 * way by capturing one page twice.
 *
 * Usage: npx tsx tools/bench/png-diff.ts <left.png> <right.png>
 */
interface Png {
  height: number;
  rgba: Uint8Array;
  width: number;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const paeth = (left: number, up: number, upLeft: number) => {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
};

const unfilter = (raw: Buffer, width: number, height: number, channels: number) => {
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[offset++]!;
    const row = y * stride;
    const previous = row - stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[row + x - channels]! : 0;
      const up = y > 0 ? pixels[previous + x]! : 0;
      const upLeft = y > 0 && x >= channels ? pixels[previous + x - channels]! : 0;
      const value = raw[offset + x]!;
      if (filter === 0) pixels[row + x] = value;
      else if (filter === 1) pixels[row + x] = (value + left) & 0xff;
      else if (filter === 2) pixels[row + x] = (value + up) & 0xff;
      else if (filter === 3) pixels[row + x] = (value + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) pixels[row + x] = (value + paeth(left, up, upLeft)) & 0xff;
      else throw new Error(`Unsupported PNG filter ${filter}`);
    }
    offset += stride;
  }
  return pixels;
};

const readHeader = (name: string, data: Buffer) => {
  const depth = data[8]!, colorType = data[9]!, interlace = data[12]!;
  if (depth !== 8) throw new Error(`${name}: only 8-bit PNGs are supported`);
  if (interlace !== 0) throw new Error(`${name}: interlaced PNGs are not supported`);
  if (colorType !== 2 && colorType !== 6) throw new Error(`${name}: only RGB/RGBA PNGs are supported`);
  return { channels: colorType === 6 ? 4 : 3, height: data.readUInt32BE(4), width: data.readUInt32BE(0) };
};

export const decodePng = (buffer: Buffer, name = "png"): Png => {
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new Error(`${name}: not a PNG`);
  let offset = PNG_SIGNATURE.length;
  let header: ReturnType<typeof readHeader> | null = null;
  const compressed: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") header = readHeader(name, data);
    else if (type === "IDAT") compressed.push(data);
    else if (type === "IEND") break;
  }
  if (!header) throw new Error(`${name}: missing IHDR`);
  const pixels = unfilter(inflateSync(Buffer.concat(compressed)), header.width, header.height, header.channels);
  if (header.channels === 4) return { height: header.height, rgba: pixels, width: header.width };
  const rgba = new Uint8Array(header.width * header.height * 4);
  for (let index = 0, source = 0; index < rgba.length; index += 4, source += 3) {
    rgba[index] = pixels[source]!;
    rgba[index + 1] = pixels[source + 1]!;
    rgba[index + 2] = pixels[source + 2]!;
    rgba[index + 3] = 255;
  }
  return { height: header.height, rgba, width: header.width };
};

export const comparePngs = (left: Png, right: Png) => {
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error(`Sizes differ: ${left.width}x${left.height} vs ${right.width}x${right.height}`);
  }
  let changedPixels = 0;
  let maximumChannelDelta = 0;
  let totalChannelDelta = 0;
  for (let index = 0; index < left.rgba.length; index += 4) {
    let delta = 0;
    for (let channel = 0; channel < 3; channel++) {
      delta = Math.max(delta, Math.abs(left.rgba[index + channel]! - right.rgba[index + channel]!));
    }
    if (delta > 0) changedPixels++;
    maximumChannelDelta = Math.max(maximumChannelDelta, delta);
    totalChannelDelta += delta;
  }
  const pixels = left.width * left.height;
  return { changedPixels, maximumChannelDelta, meanChannelDelta: totalChannelDelta / (pixels * 3), pixels };
};

const [leftPath, rightPath] = process.argv.slice(2);
if (leftPath !== undefined && rightPath !== undefined) {
  const left = decodePng(readFileSync(leftPath), leftPath);
  const right = decodePng(readFileSync(rightPath), rightPath);
  console.log(JSON.stringify(comparePngs(left, right), null, 2));
}
