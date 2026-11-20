import { useLingui } from "@lingui/react";
import { createPortal } from "react-dom";

import { MainPanel } from "../main-panel/main-panel-view";
import { PlayerHud } from "../player-hud/player-hud";
import { BottomBar } from "./bottom-bar";
import { HUD_MESSAGES } from "./messages";
import { PlacementStrip } from "./placement-strip";
import type { SettlementHudProps } from "./types";

/**
 * One React root for the always-present settlement HUD: the player corner, status line, placement strip and
 * the bottom bar with its launchers, plus the main panel through a portal into its host at the start of
 * `.settlement-ui` (the windows' order there is kept).
 */
export const SettlementHud = ({ actions, hosts, panel, store }: SettlementHudProps) => {
  const { i18n } = useLingui();
  return (
    <>
      {createPortal(<MainPanel actions={actions} panel={panel} store={store} />, hosts.mainPanel)}
      <PlayerHud
        store={store}
        onOpenMessages={actions.onOpenMessages}
        onOpenQuests={actions.onOpenQuests}
        onOpenShop={actions.onOpenShop}
        onOpenTalents={actions.onOpenTalents}
      />
      <PlacementStrip store={store} onCancel={actions.onCancelPlacement} onRotate={actions.onRotate} />
      <nav aria-label={i18n._(HUD_MESSAGES.nav.label)} className="settlement-ui__bar">
        <div className="settlement-ui__actions">
          <BottomBar campaign={actions.canCampaign} store={store} onLauncher={actions.onLauncher} />
        </div>
      </nav>
    </>
  );
};
