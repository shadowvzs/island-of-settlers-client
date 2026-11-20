import type { GameSettings } from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import type { AccountSettingsOptions } from "../account/settings/helpers";
import { IconButton } from "../components/icon-button";
import { SaveSlots } from "../save-slots/save-slots-view";
import { TITLE_CREDIT } from "./constants";
import type { TitleEntryState, TitleMode } from "./helpers";
import { TitleBackgroundView } from "./title-background";
import { TitleCampaigns } from "./title-campaigns";
import { TitleDialog } from "./title-dialog";
import { TitleMenu } from "./title-menu";
import type { TitleSession } from "./title-session";
import { TitleSettings } from "./title-settings";
import { useTitleMedia } from "./use-title-media";
import { useTitlePage } from "./use-title-page";

import "../settlement-ui/styles.css";
import "./title-page.css";

export interface TitlePageProps {
  account?: AccountSettingsOptions;
  /** The build's public base path (the `title/` folder lives under it). */
  baseUrl: string;
  entries: readonly TitleEntryState[];
  modeLabel: TitleMode;
  session: TitleSession;
  settings: GameSettings | null;
}
/**
 * The title page (GS3b, plan §7.5): the game name on top, one left panel (menu, campaigns, settings or slots) and the
 * author line, over the moving painted scene or the deployer's background; the landing and abandon questions show
 * above it.
 */
export const TitlePage = ({ account, baseUrl, entries, modeLabel, session, settings }: TitlePageProps) => {
  const model = useTitlePage({ entries, modeLabel, session });
  const background = useTitleMedia(settings, baseUrl);
  const panelClassName = `title-page__panel title-page__panel--${model.view} hud-dark-scope`;
  return (
    <div className="title-page">
      {background && <TitleBackgroundView background={background} />}
      <h1 className="title-page__heading">{model.text.heading}</h1>
      <main className={panelClassName}>
        {model.view === "menu" && (
          <TitleMenu
            adminEntries={model.adminEntries}
            entries={model.entries}
            label={model.text.menu}
          />
        )}
        {model.view === "campaigns" && model.campaignPort && (
          <TitleCampaigns initialCampaignId={model.campaignId} port={model.campaignPort} />
        )}
        {model.view === "settings" && <TitleSettings account={account} />}
        {model.view === "slots" && model.slotControls && <SaveSlots controls={model.slotControls} mode="load" />}
        {model.backShown && (
          <IconButton className="title-page__back" icon="back" label={model.text.back} onClick={model.onBack} />
        )}
        <p aria-live="polite" className="title-page__status" role="status">{model.status}</p>
      </main>
      <p className="title-page__mode">{model.modeText}</p>
      <p className="title-page__credit">{TITLE_CREDIT}</p>
      {model.landingActions.length > 0 && (
        <TitleDialog
          actions={model.landingActions}
          busy={model.busy}
          id="title-landing"
          question={model.text.landing}
        />
      )}
      {model.newGameOpen && (
        <TitleDialog
          actions={model.newGameActions}
          busy={model.busy}
          id="title-new-game"
          question={model.text.newGameQuestion}
        />
      )}
      {model.abandonOpen && (
        <TitleDialog
          actions={model.abandonActions}
          busy={model.busy}
          id="title-abandon"
          question={model.text.abandonQuestion}
        />
      )}
    </div>
  );
};
