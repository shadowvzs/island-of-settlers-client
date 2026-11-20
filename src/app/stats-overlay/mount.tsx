import { mountReactIsland } from "../components/react-island";
import type { ReadableStore } from "../components/ui-store";
import { StoredWindowFrame } from "../components/window/stored-window-frame";
import type { MountWindowFrame } from "../components/window/window-frame-controller";
import type { StatsOverlayText } from "./helpers";
import { StatsOverlayBody } from "./stats-overlay-body";

/** The info window: the shared frame around the statistics body, one React root. */
export const createStatsOverlayMount = (text: ReadableStore<StatsOverlayText>): MountWindowFrame =>
  (host, props) => mountReactIsland(host, (
    <StoredWindowFrame {...props}>
      <StatsOverlayBody text={text} />
    </StoredWindowFrame>
  ));
