import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { installHardwoodMeshPayload } from "../../src/render-common/trees/hardwood-island-mesh";

/** The gzip-compressed hardwood vertex/index payload (written by hardwood-game-meshes.mjs). */
const PAYLOAD_FILE = resolve(import.meta.dirname, "../../src/render-common/trees/hardwood-mesh-data.gz.bin");

/** Node (tests, tsx tools): installs the payload the browser fetches in loadHardwoodMeshPayload. */
export const installHardwoodMeshPayloadFromDisk = () => {
  installHardwoodMeshPayload(new Uint8Array(gunzipSync(readFileSync(PAYLOAD_FILE))).buffer);
};
