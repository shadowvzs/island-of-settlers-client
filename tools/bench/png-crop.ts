import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

/**
 * Crop an 8-bit RGB/RGBA PNG (the review tools' `toDataURL` shots) without third-party code, for
 * close inspection of a signpost, window or material detail.
 *
 *   npx tsx tools/bench/png-crop.ts <in.png> <out.png> <x> <y> <width> <height> [scale]
 */

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS: Record<number, number> = { 2: 3, 6: 4 };

interface Png { height: number; pixels: Uint8Array; width: number }

const paeth = (left: number, up: number, upLeft: number) => {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left), toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
};

const predict = (filter: number, left: number, up: number, upLeft: number) => {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return (left + up) >> 1;
  if (filter === 4) return paeth(left, up, upLeft);
  throw new Error(`Unsupported PNG filter ${filter}`);
};

const decode = (buffer: Buffer): Png => {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("Not a PNG");
  let offset = 8, width = 0, height = 0, channels = 0, bitDepth = 0;
  const data: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString("ascii", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      bitDepth = body[8]!; channels = CHANNELS[body[9]!]!;
      if (bitDepth !== 8 || channels === undefined || body[12] !== 0)
        throw new Error("Only non-interlaced 8-bit RGB/RGBA PNGs");
    } else if (type === "IDAT") data.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data)), stride = width * channels;
  const packed = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!, row = y * stride, previous = row - stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? packed[row + x - channels]! : 0;
      const up = y > 0 ? packed[previous + x]! : 0;
      const upLeft = y > 0 && x >= channels ? packed[previous + x - channels]! : 0;
      const value = raw[y * (stride + 1) + 1 + x]!;
      packed[row + x] = (value + predict(filter, left, up, upLeft)) & 0xff;
    }
  }
  const pixels = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const source = pixel * channels, target = pixel * 4;
    pixels[target] = packed[source]!; pixels[target + 1] = packed[source + 1]!;
    pixels[target + 2] = packed[source + 2]!;
    pixels[target + 3] = channels === 4 ? packed[source + 3]! : 255;
  }
  return { height, pixels, width };
};

let crcTable: Uint32Array | undefined;
const crc32 = (buffer: Buffer) => {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index++) {
      let value = index;
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, body: Buffer) => {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length, 0);
  header.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), body])), 0);
  return Buffer.concat([header, body, crc]);
};

const encode = ({ height, pixels, width }: Png) => {
  const stride = width * 3, raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4, target = y * (stride + 1) + 1 + x * 3;
      raw[target] = pixels[source]!; raw[target + 1] = pixels[source + 1]!; raw[target + 2] = pixels[source + 2]!;
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
};

/** RGBA copy with each source pixel repeated `scale` times (nearest neighbour). */
const scaleUp = ({ height, pixels, width }: Png, scale: number): Png => {
  if (scale <= 1) return { height, pixels, width };
  const scaled = { height: height * scale, pixels: new Uint8Array(width * scale * height * scale * 4),
    width: width * scale };
  for (let y = 0; y < scaled.height; y++)
    for (let x = 0; x < scaled.width; x++) {
      const source = (Math.floor(y / scale) * width + Math.floor(x / scale)) * 4;
      scaled.pixels.set(pixels.subarray(source, source + 4), (y * scaled.width + x) * 4);
    }
  return scaled;
};

const [input, output, rawX, rawY, rawWidth, rawHeight, rawScale] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: png-crop.ts <in.png> <out.png> <x> <y> <width> <height> [scale]");
const image = decode(readFileSync(input));
const x = Number(rawX ?? 0), y = Number(rawY ?? 0);
const width = Math.min(Number(rawWidth ?? image.width), image.width - x);
const height = Math.min(Number(rawHeight ?? image.height), image.height - y);
const crop: Png = { height, pixels: new Uint8Array(width * height * 4), width };
for (let row = 0; row < height; row++)
  crop.pixels.set(image.pixels.subarray(((y + row) * image.width + x) * 4,
    ((y + row) * image.width + x + width) * 4), row * width * 4);
writeFileSync(output, encode(scaleUp(crop, Number(rawScale ?? 1))));
console.log(`${output}: ${width}x${height}`);
