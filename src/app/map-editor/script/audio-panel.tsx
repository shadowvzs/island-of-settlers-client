import type { AudioKind } from "@shared/catalog";

import { getActionIcon } from "../panel/action-icons";
import { IconImage } from "../panel/fields";
import { AUDIO_UPLOAD_ACCEPT, SCRIPT_ICONS } from "./constants";
import { ScriptIconButton } from "./icon-button";
import type { ScriptWorkspace } from "./script-workspace";
import { type AudioPanelView, useAudioPanel } from "./use-audio-panel";

const UPLOAD_ICON = getActionIcon(SCRIPT_ICONS.upload);

interface AudioUploadBarProps {
  view: AudioPanelView;
}
/** The uploads tab's footer: the own-or-licence-free confirmation, then the upload icon button and its limits. */
const AudioUploadBar = ({ view }: AudioUploadBarProps) => (
  <div className="script-audio__upload">
    <label className="script-audio__confirm">
      <input checked={view.confirmed} type="checkbox" onChange={event => view.onConfirm(event.target.checked)} />
      {view.confirmLabel}
    </label>
    <label className="script-icon-button script-audio__upload-button" data-disabled={view.uploadDisabled}
      title={view.uploadLabel}>
      {UPLOAD_ICON && <IconImage icon={{ src: UPLOAD_ICON.src, srcSet: UPLOAD_ICON.srcSet }} />}
      <input accept={AUDIO_UPLOAD_ACCEPT} aria-label={view.uploadLabel} disabled={view.uploadDisabled} type="file"
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) view.onUpload(file);
        }} />
    </label>
    <small>{view.limitsText}</small>
    {view.refusal && <p className="script-audio__refusal" role="alert">{view.refusal}</p>}
  </div>
);

interface AudioPanelProps {
  kind: AudioKind;
  value: unknown;
  workspace: ScriptWorkspace;
  onChoose: (value: unknown) => void;
}
/**
 * The audio slot picker (AUDIO-CATALOG): catalog categories as tabs, a name search, one row per sound or track
 * with a preview play / stop icon button, and the map's own uploads.
 */
export const AudioPanel = ({ kind, value, workspace, onChoose }: AudioPanelProps) => {
  const view = useAudioPanel(workspace, kind, value, onChoose);
  return (
    <div className="script-audio">
      <input aria-label={view.searchLabel} className="script-audio__search" placeholder={view.searchLabel}
        type="search" value={view.query} onChange={event => view.onQuery(event.target.value)} />
      <div aria-label={view.tabsLabel} className="script-picker__tabs" role="tablist">
        {view.tabs.map(tab => (
          <button aria-selected={tab.selected} key={tab.id} role="tab" type="button" onClick={() => view.onTab(tab.id)}>
            {tab.label} <small>{tab.count}</small>
          </button>
        ))}
      </div>
      {!view.options.length && <p className="script-form__note">{view.noMatchesLabel}</p>}
      <ul className="script-audio__list">
        {view.options.map(option => (
          <li key={option.key}>
            <ScriptIconButton icon={option.previewIcon} label={option.previewLabel}
              onClick={() => view.onPreview(option)} />
            <button aria-pressed={option.selected} className="script-audio__choice" type="button"
              onClick={() => view.onChoose(option)}>
              <span>{option.label}</span> <small>{option.detail}</small>
            </button>
            {option.uploaded && <ScriptIconButton icon="remove" label={option.removeLabel}
              onClick={() => view.onRemove(option)} />}
          </li>
        ))}
      </ul>
      {view.showsUpload && <AudioUploadBar view={view} />}
    </div>
  );
};
