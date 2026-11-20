import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

/** Renders the synthesised victory fanfare to a WAV file for listening, and reports its peak and length. */
const output = resolve("../resources/audio-previews");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.goto(url);
  const result = await page.evaluate(async () => {
    const { scheduleVictoryFanfare } = await import(String("/src/app/audio/victory-fanfare.ts"));
    const rate = 44100, context = new OfflineAudioContext(2, rate * 4.5, rate);
    scheduleVictoryFanfare(context, .05, 1);
    const buffer = await context.startRendering();
    const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
    let peak = 0, last = 0;
    channels[0]!.forEach((value, index) => {
      peak = Math.max(peak, Math.abs(value));
      if (Math.abs(value) > .01) last = index;
    });
    const pcm = new Int16Array(buffer.length * 2);
    for (let i = 0; i < buffer.length; i++) for (let c = 0; c < 2; c++)
      pcm[i * 2 + c] = Math.max(-1, Math.min(1, channels[c]![i]!)) * 32767;
    return { audible: last / rate, peak, pcm: Array.from(new Uint8Array(pcm.buffer)), rate };
  });
  const data = Buffer.from(result.pcm), header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(result.rate, 24); header.writeUInt32LE(result.rate * 4, 28);
  header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(resolve(output, "victory-fanfare.wav"), Buffer.concat([header, data]));
  console.log(`peak ${result.peak.toFixed(3)}, audible until ${result.audible.toFixed(2)} s`);
} finally {
  await browser.close();
  await server.close();
}
