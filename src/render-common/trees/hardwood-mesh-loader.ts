import payloadUrl from "./hardwood-mesh-data.gz.bin?url";
import { installHardwoodMeshPayload, isHardwoodMeshPayloadInstalled } from "./hardwood-island-mesh";

let loading: Promise<void> | undefined;

/** The file is a gzip stream (1.5 MB instead of 2.1 MB) whether or not the server compresses binary files. */
const fetchPayload = async () => {
  const response = await fetch(payloadUrl);
  if (!response.ok || !response.body) throw new Error(`Hardwood mesh payload: HTTP ${response.status}`);
  const unpacked = new Response(response.body.pipeThrough(new DecompressionStream("gzip")));
  installHardwoodMeshPayload(await unpacked.arrayBuffer());
};

/**
 * Downloads the hardwood vertex/index payload once per context (page or worker), as its own cacheable
 * file outside the startup JS. A failed download may be retried.
 */
export const loadHardwoodMeshPayload = () => {
  if (isHardwoodMeshPayloadInstalled()) return Promise.resolve();
  loading ??= fetchPayload().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
};
