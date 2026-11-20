import { spawn } from "node:child_process";
import { join } from "node:path";
import type { Page } from "playwright-core";

/** A bounded contextual clip from real rendered frames, encoded with the host's ffmpeg. */
export const startClip = async (page: Page, directory: string, id: string, seconds = 8) => {
  const client = await page.context().newCDPSession(page);
  const filename = `${id.replace(/[^a-zA-Z0-9_-]/g, "-")}.webm`;
  const encoder = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-vcodec", "mjpeg", "-framerate", "10",
    "-i", "pipe:0", "-an", "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8",
    "-b:v", "800k", join(directory, filename)
  ], { stdio: ["pipe", "ignore", "pipe"] });
  let error = "";
  let frames = 0;
  let accepting = true;
  encoder.stderr.on("data", data => { if (error.length < 4000) error += String(data); });
  let resolveFirstFrame: () => void, rejectFirstFrame: (error: Error) => void;
  const firstFrame = new Promise<void>((resolve, reject) => {
    resolveFirstFrame = resolve; rejectFirstFrame = reject;
  });
  // A startup rejection may arrive while the CDP start command is still pending.
  void firstFrame.catch(() => {});
  const fail = (failure: Error) => {
    error = failure.message; accepting = false; rejectFirstFrame(failure);
  };
  encoder.on("error", fail);
  encoder.stdin.on("error", fail);
  const completed = new Promise<number | null>(resolve => encoder.on("close", code => {
    if (!frames) rejectFirstFrame(new Error(error || `ffmpeg closed before first frame (${code})`));
    resolve(code);
  }));
  let lastFrame = 0;
  client.on("Page.screencastFrame", event => {
    void client.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
    const now = Date.now();
    if (!accepting || now - lastFrame < 95 || frames >= seconds * 10) return;
    lastFrame = now;
    if (encoder.stdin.writableLength > 2_000_000) return;
    frames++;
    encoder.stdin.write(Buffer.from(event.data, "base64"));
    resolveFirstFrame();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopPromise: Promise<{ filename?: string; frames: number; error?: string }> | undefined;
  const stop = () => stopPromise ??= (async () => {
    accepting = false;
    clearTimeout(timer);
    await client.send("Page.stopScreencast").catch(() => {});
    await client.detach().catch(() => {});
    encoder.stdin.end();
    const killTimer = setTimeout(() => encoder.kill("SIGKILL"), 15_000);
    const code = await completed;
    clearTimeout(killTimer);
    if (code !== 0 || !frames || error) return { frames, error: error || `ffmpeg exit ${code}; frames=${frames}` };
    return { filename, frames };
  })();
  const startupTimer = setTimeout(() => rejectFirstFrame(new Error("No real screencast frame within 5 seconds")), 5000);
  try {
    await Promise.all([
      client.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: 960, maxHeight: 640 }),
      firstFrame
    ]);
    // Bound the clip from its first accepted real frame, including immediately completed cases.
    timer = setTimeout(() => { void stop(); }, seconds * 1000);
    return { stop };
  } catch (failure) {
    await stop();
    throw failure;
  } finally {
    clearTimeout(startupTimer);
  }
};
