import { INPUT_SIZE_CLASSES } from "../../../components/input-sizes";
import { RewardPicker } from "../../reward-picker/reward-picker";
import type { CampaignEditor } from "../campaign-editor";
import { MapExits } from "../paths/exits/map-exits";
import { TranslationField } from "../translation/translation-field";
import { LAUNCH_CARGO_COPY, LAUNCH_CARGO_FILTER, LAUNCH_CARGO_TABS } from "./constants";
import { type SelectedMapView, useMapSettings } from "./use-map-settings";

interface LaunchCargoProps {
  launch: NonNullable<SelectedMapView["launch"]>;
}
/** Home-island mode only: what an expedition must ship (collapsed until edited) and the soldier cap. */
const LaunchCargo = ({ launch }: LaunchCargoProps) => (
  <details className="campaign-editor__rewards campaign-editor__launch">
    <summary title={launch.titleHint}>{launch.title}</summary>
    <label className="campaign-editor__label campaign-editor__label--inline" title={launch.soldierCapHint}>
      <span>{launch.soldierCapLabel}</span>
      <input className={INPUT_SIZE_CLASSES.narrow} min={0} type="number" value={launch.soldierCap}
        onChange={event => launch.onSoldierCapChange(event.target.value)} />
    </label>
    <RewardPicker copy={LAUNCH_CARGO_COPY} entries={launch.entries} filter={LAUNCH_CARGO_FILTER}
      idPrefix="campaign-map-cargo" tabs={LAUNCH_CARGO_TABS} onChange={launch.onChange} />
  </details>
);

interface MapRewardsProps {
  selected: SelectedMapView;
}
/** The victory rewards the game mode pays; a mode that pays none (or only gems and XP) says what it keeps hidden. */
const MapRewards = ({ selected }: MapRewardsProps) => (
  <section aria-label={selected.rewardsTitle} className="campaign-editor__rewards">
    <h4>{selected.rewardsTitle}</h4>
    {selected.rewardsNote && <p className="campaign-editor__hint">{selected.rewardsNote}</p>}
    {selected.rewards && <RewardPicker entries={selected.rewards.entries} filter={selected.rewards.filter}
      idPrefix="campaign-map-rewards" tabs={selected.rewards.tabs} onChange={selected.rewards.onChange} />}
  </section>
);

interface MapSettingsProps {
  editor: CampaignEditor;
}
/**
 * The selected map: name, minimum level, map file (Open map), Ready state, Delete, exits, and by game mode the
 * launch cargo and the rewards.
 */
export const MapSettings = ({ editor }: MapSettingsProps) => {
  const { emptyNote, selected, title } = useMapSettings(editor);
  return (
    <section aria-label={title} className="campaign-editor__card">
      <h3>{title}</h3>
      {!selected && <p className="campaign-editor__hint">{emptyNote}</p>}
      {selected && (
        <div className="campaign-editor__form" key={selected.id}>
          <div className="campaign-editor__toolbar">
            <span className="campaign-editor__badge" data-state={selected.badge.state}>{selected.badge.label}</span>
            <span className="campaign-editor__toolbar-actions">
              <button className="campaign-editor__button campaign-editor__button--primary" disabled={selected.busy}
                type="button" onClick={() => editor.openMap(selected.id)}>{selected.openLabel}</button>
              <button className="campaign-editor__button" disabled={selected.busy} type="button"
                onClick={() => editor.setMapReady(selected.id, !selected.ready)}>{selected.readyLabel}</button>
              <button className="campaign-editor__button campaign-editor__button--danger" disabled={selected.busy}
                type="button" onClick={() => editor.deleteMap(selected.id)}>{selected.deleteLabel}</button>
            </span>
          </div>
          <p className="campaign-editor__hint">{selected.fileNote}</p>
          {selected.modeWarnings.length > 0 && (
            <ul className="campaign-editor__mode-warnings">
              {selected.modeWarnings.map(warning => <li key={warning} role="alert">{warning}</li>)}
            </ul>
          )}
          <TranslationField label={selected.nameLabel} text={selected.name} onChange={selected.onNameChange} />
          <label className="campaign-editor__label campaign-editor__label--inline">
            <span>{selected.levelLabel}</span>
            <input className={INPUT_SIZE_CLASSES.narrow} min={0} type="number" value={selected.minimumLevel}
              onChange={event => selected.onLevelChange(event.target.value)} />
          </label>
          <MapExits editor={editor} map={selected.map} />
          {selected.launch && <LaunchCargo launch={selected.launch} />}
          <MapRewards selected={selected} />
        </div>
      )}
    </section>
  );
};
