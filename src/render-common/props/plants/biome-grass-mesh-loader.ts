import payloadUrl from "./biome-grass-data.gz.bin?url";
import { installBiomeGrassPayload, isBiomeGrassPayloadInstalled } from "./biome-grass-mesh";

let loading: Promise<void> | undefined;

/** One gzip payload as an ArrayBuffer (the browser decompresses it natively). */
export const fetchBiomeGrassPayload = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Biome grass payload: HTTP ${response.status}`);
  const unpacked = new Response(response.body.pipeThrough(new DecompressionStream("gzip")));
  return unpacked.arrayBuffer();
};

/**
 * Downloads the high/min prop-mesh payload once per context (page or worker), as its own cacheable
 * file outside the startup JS. A failed download may be retried.
 */
export const loadBiomeGrassMeshPayload = () => {
  if (isBiomeGrassPayloadInstalled()) return Promise.resolve();
  loading ??= fetchBiomeGrassPayload(payloadUrl).then(installBiomeGrassPayload).catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
};
