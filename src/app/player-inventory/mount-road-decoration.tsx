import { useLingui } from "@lingui/react";

import type { RoadDecorationFrame } from "../../shared/settlement/road-decoration-state";
import { useExternalStore } from "../components/external-store";
import { IconButton } from "../components/icon-button";
import { mountReactIsland } from "../components/react-island";
import type { ReadableStore } from "../components/ui-store";
import { PlayerItemIcon } from "./item-icon";
import { playerItemName } from "./item-presentation";
import { ROAD_DECORATION_MESSAGES as M } from "./road-decoration-presentation";
import type { RoadDecorationWindowControl } from "./road-decoration-window";
import { useRoadDecorationActions } from "./use-road-decoration-actions";

interface Options {
  control: RoadDecorationWindowControl;
  selection: ReadableStore<RoadDecorationFrame | undefined>;
  close(): void;
  refresh(uid: number): void;
}
const DecorationPanel = ({ control, frame, close, refresh }: Omit<Options, "selection"> & { frame?: RoadDecorationFrame }) => {
  const { i18n } = useLingui();
  const actions = useRoadDecorationActions({ control, frame, close, refresh });
  if (!frame) return <p>{i18n._(M.missing)}</p>;
  return <div className="road-decoration-panel">
    <div style={{ width: 160, height: 160 }}><PlayerItemIcon item={frame.item} /></div>
    <strong>{playerItemName(frame.item, i18n)}</strong>
    <p hidden={!actions.message} role="status">{actions.message}</p>
    <div className="road-decoration-panel__actions">
      <IconButton disabled={actions.busy} icon="export" label={i18n._(M.pickUp)} onClick={actions.pickUp} />
      <IconButton disabled={actions.busy} icon="rotate" label={i18n._(M.rotate)} onClick={actions.rotate} />
      <IconButton disabled={actions.busy} icon="drag" label={i18n._(M.move)} onClick={actions.move} />
    </div>
  </div>;
};
const DecorationMount = ({ selection, ...options }: Options) => {
  const frame = useExternalStore(selection);
  return <DecorationPanel key={frame?.uid ?? "missing"} {...options} frame={frame} />;
};
export const createRoadDecorationMount = (options: Options) => (container: HTMLElement) =>
  mountReactIsland(container, <DecorationMount {...options} />);
