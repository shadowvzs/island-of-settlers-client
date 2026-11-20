import { useExternalStore } from "../../components/external-store";
import { mountReactIsland } from "../../components/react-island";
import { PanelFrame } from "../../components/window/panel-frame";
import type { CornerPanelsStore } from "../corner-panel";
import type { CornerRowStore } from "./corner-row";
import { CornerRow } from "./corner-row-view";

interface CornerPanelsProps {
  panels: CornerPanelsStore;
  onClose: (id: string) => void;
}
const CornerPanels = ({ panels, onClose }: CornerPanelsProps) => (
  <>
    {useExternalStore(panels).map(panel => (
      <PanelFrame
        className={panel.className}
        content={panel.content}
        key={panel.id}
        label={panel.label}
        open={panel.open}
        onClose={() => onClose(panel.id)}
      />
    ))}
  </>
);

interface CornerProps extends CornerPanelsProps {
  row: CornerRowStore;
}
/** The top right corner: the icon row (`.settings__buttons`) and the panels it opens. */
const Corner = ({ panels, row, onClose }: CornerProps) => (
  <>
    <div className="settings__buttons">
      <CornerRow store={row} />
    </div>
    <CornerPanels panels={panels} onClose={onClose} />
  </>
);

/** Mounts the corner into `.settings` (loaded once the island is shown). */
export const mountCorner = (root: HTMLElement, props: CornerProps) => mountReactIsland(root, <Corner {...props} />);
