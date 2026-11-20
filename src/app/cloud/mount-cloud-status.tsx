import { mountReactIsland } from "../components/react-island";
import type { ReadableStore } from "../components/ui-store";
import type { CloudSaveStatus } from "../save-store/remote-save-store";
import { CloudStatus } from "./cloud-status";
import type { VerificationState } from "./verification-status";

/** Mounts the cloud save line into its own host in the viewport. */
export const mountCloudStatus = (viewport: HTMLElement, status: ReadableStore<CloudSaveStatus | null>,
  verification: ReadableStore<VerificationState | null>, onOpen: () => void) => {
  const host = document.createElement("div");
  host.className = "cloud-status-host";
  viewport.append(host);
  const unmount = mountReactIsland(host, <CloudStatus status={status} verification={verification} onOpen={onOpen} />);
  return () => {
    unmount();
    host.remove();
  };
};
