import { execFileSync } from "node:child_process";

import { createImage, type RgbImage, type TimedFrame } from "./reference-image";

/**
 * ffmpeg I/O of the reference tuner (TOOL-8): clip probing, frame extraction into packed RGB,
 * PNG decode/encode. Extracted frames stay in memory or in the caller's scratch output folder;
 * nothing derived from a reference clip is ever written into the repository.
 */

export interface ClipInfo {
  duration: number;
  fps: number;
  height: number;
  width: number;
}

const MAX_BUFFER = 1024 * 1024 * 1024;

const ratio = (text: string) => {
  const [top, bottom] = text.split("/").map(Number);
  return bottom ? top! / bottom : top!;
};

export const probeClip = (file: string): ClipInfo => {
  const output = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=width,height,avg_frame_rate:format=duration", "-of", "json", file], { encoding: "utf8" });
  const parsed = JSON.parse(output) as { format: { duration: string };
    streams: { avg_frame_rate: string; height: number; width: number }[] };
  const stream = parsed.streams[0]!;
  return { duration: Number(parsed.format.duration), fps: ratio(stream.avg_frame_rate), height: stream.height,
    width: stream.width };
};

const splitFrames = (buffer: Buffer, width: number, height: number) => {
  const size = width * height * 3, frames: RgbImage[] = [];
  for (let offset = 0; offset + size <= buffer.length; offset += size)
    frames.push({ height, pixels: new Uint8Array(buffer.subarray(offset, offset + size)), width });
  return frames;
};

/** Even output height of a `width`-wide scale of a `source` frame (ffmpeg `scale=W:-2`). */
const scaledHeight = (source: { height: number; width: number }, width: number) =>
  Math.round((source.height * width) / source.width / 2) * 2;

export interface ExtractOptions {
  duration: number;
  fps: number;
  start: number;
  /** Analysis width in pixels (the height follows the aspect). */
  width: number;
}

/** Frames of `file` from `start` for `duration` seconds at `fps`, scaled to `width`. */
export const extractFrames = (file: string, options: ExtractOptions): TimedFrame[] => {
  const { duration, fps, start, width } = options;
  const height = scaledHeight(probeClip(file), width);
  const buffer = execFileSync("ffmpeg", ["-v", "error", "-ss", String(start), "-t", String(duration), "-i", file,
    "-vf", `fps=${fps},scale=${width}:${height}:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
  { maxBuffer: MAX_BUFFER });
  return splitFrames(buffer, width, height).map((image, index) => ({ image, seconds: index / fps }));
};

/** One full-size still of `file` at `seconds` written as PNG (for the side-by-side sheet). */
export const writeClipStill = (file: string, seconds: number, output: string, width = 1280) => {
  execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", String(seconds), "-i", file, "-frames:v", "1",
    "-vf", `scale=${width}:-2`, output]);
};

/** Decodes an image file (PNG, JPEG, WebP) into packed RGB, optionally scaled to `width`. */
export const readImage = (file: string, width?: number): RgbImage => {
  const size = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=width,height", "-of", "json", file], { encoding: "utf8" })).streams[0] as { height: number;
    width: number };
  const outWidth = width ?? size.width, outHeight = width ? scaledHeight(size, width) : size.height;
  const buffer = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-frames:v", "1", "-vf",
    `scale=${outWidth}:${outHeight}:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
  { maxBuffer: MAX_BUFFER });
  return splitFrames(buffer, outWidth, outHeight)[0] ?? createImage(outWidth, outHeight);
};

/** Writes packed RGB as PNG. */
export const writeImage = (image: RgbImage, output: string) => {
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size",
    `${image.width}x${image.height}`, "-i", "-", "-frames:v", "1", "-pix_fmt", "rgb24", output],
  { input: image.pixels });
};
