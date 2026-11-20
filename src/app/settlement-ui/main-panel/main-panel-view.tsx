import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../shared/i18n/translate";
import type { MountWindowContent } from "../../components/lazy-react-content";
import { useLazyReactContent } from "../../components/use-lazy-react-content";
import { WindowFrame } from "../../components/window/window-frame";
import type { SettlementHudActions } from "../hud/types";
import { SETTLEMENT_MESSAGES } from "../messages";
import type { SettlementUiStore } from "../ui-store";
import { BuildView } from "./build-view";
import type { MainPanelVisibilityStore } from "./main-panel";
import { MenuView } from "./menu-view";
import { NoticesView } from "./notices-view";
import { useMainPanel } from "./use-main-panel";

interface FleetHostProps {
  hidden: boolean;
  loadFleet: () => Promise<MountWindowContent>;
}
/** The Ships view: the fleet loads with its own chunk the first time the view shows. */
const FleetHost = ({ hidden, loadFleet }: FleetHostProps) => {
  const { i18n } = useLingui();
  const hostRef = useLazyReactContent<HTMLDivElement>("Fleet", !hidden, loadFleet, {
    error: name => translateMessage(i18n, SETTLEMENT_MESSAGES.common.loadFailed, { name }),
    loading: name => translateMessage(i18n, SETTLEMENT_MESSAGES.common.loading, { name })
  });
  return <div className="settlement-ui__overview settlement-ui__fleet" hidden={hidden} ref={hostRef} />;
};

interface MainPanelProps {
  actions: SettlementHudActions;
  panel: MainPanelVisibilityStore;
  store: SettlementUiStore;
}
/** The movable main window: Build, Main selection, Fleet and Notifications, one view at a time. */
export const MainPanel = ({ actions, panel, store }: MainPanelProps) => {
  const { i18n } = useLingui();
  const { buildRef, ...frame } = useMainPanel(panel);
  return (
    <WindowFrame
      className={frame.className}
      focusOnOpen={frame.focusOnOpen}
      name={i18n._(SETTLEMENT_MESSAGES.menu.windowName)}
      opened={frame.opened}
      title={frame.title}
      titleId="settlement-panel-title"
      visible={frame.visible}
      onClose={actions.onClosePanel}
    >
      <div className="settlement-ui__picker" hidden={frame.hideBuild} ref={buildRef}>
        <BuildView
          canSurvey={actions.canSurvey}
          panel={panel}
          store={store}
          onHomeSandbox={actions.onHomeSandbox}
          onPickBuilding={actions.onPickBuilding}
          onRoadTool={actions.onRoadTool}
          onSurveyJob={actions.onSurveyJob}
        />
      </div>
      <div aria-label={i18n._(SETTLEMENT_MESSAGES.menu.mainSelection)} className="settlement-ui__menu" hidden={frame.hideMenu}>
        <MenuView
          shortcuts={actions.menuShortcuts}
          onMenuEntry={actions.onMenuEntry}
        />
      </div>
      <FleetHost hidden={frame.hideShips} loadFleet={actions.loadFleet} />
      <div className="settlement-ui__overview settlement-ui__notices" hidden={frame.hideNotices}>
        <NoticesView panel={panel} store={store} onFocusBuilding={actions.onFocusBuilding} />
      </div>
    </WindowFrame>
  );
};
