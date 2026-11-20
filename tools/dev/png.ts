import { deflateSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Uint8Array) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

/** Minimal RGBA PNG encoder for debug images. */
export const encodePng = (width: number, height: number, rgba: Uint8Array) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array())
  ]);
};

const paeth = (left: number, up: number, upLeft: number) => {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left), toUp = Math.abs(estimate - up), toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
};

/** Row filtered with PNG filter `type` (0 none, 1 sub, 2 up, 3 average, 4 Paeth), 4 bytes per pixel. */
const filterRow = (row: Uint8Array, previous: Uint8Array, type: number) => {
  const out = new Uint8Array(row.length + 1);
  out[0] = type;
  for (let index = 0; index < row.length; index++) {
    const left = index >= 4 ? row[index - 4]! : 0, up = previous[index]!;
    const upLeft = index >= 4 ? previous[index - 4]! : 0;
    const predictors = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)];
    out[index + 1] = (row[index]! - predictors[type]!) & 255;
  }
  return out;
};

const filterCost = (filtered: Uint8Array) => {
  let cost = 0;
  for (let index = 1; index < filtered.length; index++) cost += Math.min(filtered[index]!, 256 - filtered[index]!);
  return cost;
};

/**
 * Smallest-effort RGBA PNG for shipped UI art (cursors): per-row adaptive filtering (minimum absolute
 * difference) and maximum deflate compression. Same pixels as `encodePng`, a fraction of the bytes.
 */
export const encodeOptimizedPng = (width: number, height: number, rgba: Uint8Array) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const stride = width * 4;
  const rows: Uint8Array[] = [];
  let previous: Uint8Array = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    const candidates = [0, 1, 2, 3, 4].map(type => filterRow(row, previous, type));
    rows.push(candidates.reduce((best, candidate) => filterCost(candidate) < filterCost(best) ? candidate : best));
    previous = row;
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9, memLevel: 9 })),
    chunk("IEND", new Uint8Array())
  ]);
};
