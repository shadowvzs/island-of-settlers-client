import type { AdminPorts } from "../admin-ports";
import { ChangeDialog } from "./change-dialog";
import { PlaySection } from "./play-section";
import { ProgressionSection } from "./progression-section";
import { SettingsFooter } from "./settings-footer";
import { SwitchGroup } from "./switch-row";
import { TitlePageSection } from "./title-page-section";
import { useGameSettingsTab } from "./use-game-settings-tab";

interface GameSettingsTabProps {
  ports: AdminPorts;
}
/** Game settings: one flat list of switches (plan §5.5 order), the title page, footer and confirmation. */
export const GameSettingsTab = ({ ports }: GameSettingsTabProps) => {
  const tab = useGameSettingsTab(ports);
  if (tab.status === "error") return <p className="admin-settings__issues" role="alert">{tab.errorText}</p>;
  if (!tab.view || !tab.editors) return <p aria-busy="true" className="admin-settings__note">…</p>;
  const { editors, view } = tab;
  return (
    <div className="admin-settings">
      <div className="admin-settings__columns">
        <PlaySection editors={editors} view={view.play} />
        <SwitchGroup rows={view.features.rows} title={view.features.title} onSwitch={editors.onSwitch} />
        <SwitchGroup rows={view.online.rows} title={view.online.title} onSwitch={editors.onSwitch} />
        <ProgressionSection editors={editors} view={view.progression} />
        <TitlePageSection view={view.titlePage} onSwitch={editors.onSwitch} onTitleFile={editors.onTitleFile} />
      </div>
      <SettingsFooter busy={tab.busy} canSave={tab.canSave} dirty={tab.dirty} issues={view.issues.messages}
        outcome={tab.outcome} presets={view.presets} texts={tab.footer} onPreset={editors.onPreset}
        onReload={() => void tab.reload()} onSave={tab.requestSave} />
      {tab.confirmationView && (
        <ChangeDialog view={tab.confirmationView} onCancel={tab.cancelConfirmation} onConfirm={tab.confirmSave} />
      )}
    </div>
  );
};
