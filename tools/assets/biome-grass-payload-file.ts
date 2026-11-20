import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import {
  installBiomeGrassHeroPayload,
  installBiomeGrassPayload
} from "../../src/render-common/props/plants/biome-grass-mesh";

const PAYLOAD_FILE = resolve(import.meta.dirname,
  "../../src/render-common/props/plants/biome-grass-data.gz.bin");
const HERO_FILE = resolve(import.meta.dirname,
  "../../src/render-common/props/plants/biome-grass-hero-data.gz.bin");

const installFromDisk = (file: string, install: (buffer: ArrayBuffer) => void) =>
  install(new Uint8Array(gunzipSync(readFileSync(file))).buffer);

/** Node (tests, tsx tools): installs the runtime payload the browser fetches in biome-grass-mesh-loader. */
export const installBiomeGrassPayloadFromDisk = () => installFromDisk(PAYLOAD_FILE, installBiomeGrassPayload);

/** Node icon/preview tools: installs the hero payload for close-up renders. */
export const installBiomeGrassHeroPayloadFromDisk = () =>
  installFromDisk(HERO_FILE, installBiomeGrassHeroPayload);
