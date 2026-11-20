import type { I18n } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import type { RoadDecorationFrame } from "../../shared/settlement/road-decoration-state";
import { createLazyReactWindow } from "../components/lazy-react-window";
import { createExternalStore } from "../components/ui-store";
import { INVENTORY_MESSAGES as M } from "./messages";
import { ROAD_DECORATION_MESSAGES } from "./road-decoration-presentation";

import "./road-decoration.css";

export interface RoadDecorationWindowControl {
  find(uid: number): RoadDecorationFrame | undefined;
  move(uid: number): Promise<true | string>;
  pickUp(uid: number): Promise<true | string>;
  rotate(uid: number): Promise<true | string>;
}
export const createRoadDecorationWindow = (container: HTMLElement, control: RoadDecorationWindowControl, i18n?: I18n) => {
  const selection = createExternalStore<RoadDecorationFrame | undefined>(undefined);
  const window = createLazyReactWindow({ container, i18n, layerClassName: "settlement-ui",
    className: "road-decoration-window", contentClassName: "road-decoration-window__body",
    heading: () => translateMessage(i18n, ROAD_DECORATION_MESSAGES.title), id: "road-decoration-title",
    load: async () => (await import("./mount-road-decoration")).createRoadDecorationMount({ control, selection,
      close: () => window.close(), refresh: uid => selection.set(control.find(uid)) }),
    texts: { error: () => translateMessage(i18n, M.failed), loading: () => translateMessage(i18n, M.loading) } });
  return { ...window, open: (uid: number) => { selection.set(control.find(uid)); window.open(); } };
};
