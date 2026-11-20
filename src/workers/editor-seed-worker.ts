import { generateWorld, type WorldOptions } from "../shared/world/generation/generate-world";
import { getWorldTransferables } from "../shared/world/world-data";

const scope = self as unknown as { onmessage: ((event: MessageEvent<WorldOptions>) => void) | null;
  postMessage(value: unknown, transfer?: Transferable[]): void };
scope.onmessage = ({ data }) => {
  try {
    const world = generateWorld(data, undefined, phase => scope.postMessage({ phase }));
    scope.postMessage({ world }, getWorldTransferables(world));
  } catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
