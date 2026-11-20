import { useLingui } from "@lingui/react";

import { Tabs } from "../../components/tabs";
import { useEditorMode } from "../map-rules/use-editor-mode";
import type { CampaignEditor } from "./campaign-editor";
import { CheckSection } from "./check/check-section";
import { DeleteConfirmation } from "./confirmation/delete-confirmation";
import { CampaignDetails } from "./details/campaign-details";
import { MapsSection } from "./map-list/maps-section";
import { MapView } from "./map-view/map-view";
import { SpeakersSection } from "./speakers/speakers-section";
import { StorySection } from "./story/story-section";
import { TextTableSection } from "./text-table/text-table-section";
import { useCampaignEditorApp, useCampaignList, useWorkspaceToolbar } from "./use-campaign-editor";
import { workspaceTabLabels } from "./workspace-helpers";

import "./campaign-editor.css";

interface EditorProps {
  editor: CampaignEditor;
}

/** The campaign list: Draft/Ready badge, unsaved mark, create, rename and delete. */
const CampaignList = ({ editor }: EditorProps) => {
  const view = useCampaignList(editor);
  return (
    <nav aria-label={view.title} className="campaign-editor__list">
      <h2>{view.title}</h2>
      <button className="campaign-editor__button campaign-editor__button--primary" disabled={view.busy} type="button"
        onClick={editor.createCampaign}>{view.createLabel}</button>
      {!view.rows.length && <p className="campaign-editor__hint">{view.emptyNote}</p>}
      <ul>
        {view.rows.map(row => (
          <li aria-current={row.selected} className="campaign-editor__list-row" key={row.id}>
            <button className="campaign-editor__list-name" type="button" onClick={() => editor.selectCampaign(row.id)}>
              <span>{row.name}</span>
              <span className="campaign-editor__badge" data-state={row.badge.state}>{row.badge.label}</span>
              {row.unsaved && <span aria-hidden="true" className="campaign-editor__unsaved-dot" />}
            </button>
            <span className="campaign-editor__list-actions">
              <button className="campaign-editor__button campaign-editor__button--quiet" disabled={view.busy}
                type="button" onClick={() => editor.renameCampaign(row.id)}>{view.renameLabel}</button>
              <button className="campaign-editor__button campaign-editor__button--danger" disabled={view.busy}
                type="button" onClick={() => editor.deleteCampaign(row.id)}>{view.deleteLabel}</button>
            </span>
          </li>
        ))}
      </ul>
    </nav>
  );
};

/** Name, badges, Save, Check and the Ready switch of the open campaign. */
const WorkspaceToolbar = ({ editor }: EditorProps) => {
  const view = useWorkspaceToolbar(editor);
  return (
    <div className="campaign-editor__toolbar">
      <h2>{view.name}</h2>
      <span className="campaign-editor__badge" data-state={view.badge.state}>{view.badge.label}</span>
      {view.dirty && <span className="campaign-editor__badge" data-state="unsaved">{view.unsavedLabel}</span>}
      <span className="campaign-editor__toolbar-actions">
        <button className="campaign-editor__button campaign-editor__button--primary" disabled={view.busy || !view.dirty}
          type="button" onClick={editor.save}>{view.saveLabel}</button>
        <button className="campaign-editor__button" disabled={view.busy} type="button" onClick={editor.checkReady}>
          {view.checkLabel}
        </button>
        <button className="campaign-editor__button" disabled={view.busy} type="button"
          onClick={() => editor.setCampaignReady(!view.ready)}>{view.readyLabel}</button>
      </span>
      {view.ready && <p className="campaign-editor__hint">{view.readyNote}</p>}
    </div>
  );
};

/** The open campaign: toolbar and the section tabs (every panel stays mounted, so drafts keep their state). */
const CampaignWorkspace = ({ editor }: EditorProps) => {
  const { i18n } = useLingui();
  const labels = workspaceTabLabels(i18n);
  const { tabRequest, tabsLabel } = useWorkspaceToolbar(editor);
  return (
    <main className="campaign-editor__workspace">
      <WorkspaceToolbar editor={editor} />
      <Tabs idPrefix="campaign-editor" items={[
          { content: <CampaignDetails editor={editor} />, id: "details", label: labels.details },
          { content: <MapsSection editor={editor} />, id: "maps", label: labels.maps },
          { content: <MapView editor={editor} />, id: "map-view", label: labels.mapView },
          { content: <StorySection editor={editor} />, id: "story", label: labels.story },
          { content: <SpeakersSection editor={editor} />, id: "speakers", label: labels.speakers },
          { content: <TextTableSection editor={editor} />, id: "translations", label: labels.translations },
          { content: <CheckSection editor={editor} />, id: "validation", label: labels.validation }
        ]} label={tabsLabel} listClassName="campaign-editor__tabs" panelClassName="campaign-editor__panel"
        request={tabRequest} tabClassName="campaign-editor__tab" />
    </main>
  );
};

interface ServerSyncProps {
  view: ReturnType<typeof useCampaignEditorApp>["server"];
  onSync: () => void;
}

/** Local-only / Server badge and the sync icon button (the tooltip says what it does or why it cannot). */
const ServerSync = ({ view, onSync }: ServerSyncProps) => (
  <span className="campaign-editor__server">
    <span className="campaign-editor__badge" data-state={view.tone} title={view.tooltip}>{view.badge}</span>
    <button aria-label={view.tooltip} className="campaign-editor__icon-button" disabled={view.disabled}
      title={view.tooltip} type="button" onClick={onSync}>
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1 0 8.5" />
        <path d="M12 20v-7m-2.5 2.5L12 13l2.5 2.5" />
      </svg>
    </button>
  </span>
);

/** The game mode the editor follows (plan §13.4): mode, reward scope and "not loaded" until the settings arrive. */
const GameModeBadges = () => {
  const mode = useEditorMode();
  return (
    <span className="campaign-editor__mode" title={mode.source}>
      <span className="campaign-editor__badge" data-state="mode">{mode.mode}</span>
      <span className="campaign-editor__badge" title={mode.rewardsHint}>{mode.rewards}</span>
      {mode.notLoaded && <span className="campaign-editor__badge" data-state="unsaved">{mode.notLoaded}</span>}
    </span>
  );
};

/** Campaign mode of `editor.html` (C6): list on the side, the open campaign beside it. */
export const CampaignEditorApp = ({ editor }: EditorProps) => {
  const view = useCampaignEditorApp(editor);
  return (
    <div aria-busy={!view.loaded} className="campaign-editor">
      <header className="campaign-editor__header">
        <h1>{view.title}</h1>
        <GameModeBadges />
        <label className="campaign-editor__check">
          <input checked={view.artworkConfirmed} type="checkbox"
            onChange={event => editor.setArtworkConfirmed(event.target.checked)} />
          {view.artworkLabel}
        </label>
        <ServerSync view={view.server} onSync={() => editor.syncWithServer()} />
        <button className="campaign-editor__button" type="button" onClick={editor.backToMapEditor}>
          {view.backLabel}
        </button>
      </header>
      {view.memoryNote && <p className="campaign-editor__notice" data-error="true">{view.memoryNote}</p>}
      {view.notice && <p className="campaign-editor__notice" data-error={view.notice.error} role="status">
        {view.notice.text}
      </p>}
      <div className="campaign-editor__body">
        <CampaignList editor={editor} />
        {view.hasSelection && <CampaignWorkspace editor={editor} />}
        {!view.hasSelection && <p className="campaign-editor__empty">{view.noSelection}</p>}
      </div>
      <DeleteConfirmation editor={editor} />
    </div>
  );
};
