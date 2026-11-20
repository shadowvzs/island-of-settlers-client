import { Popup } from "../../components/popup";
import { CampaignImage } from "../campaign-image/campaign-image";
import { STORY_PANEL_TITLE_ID } from "./constants";
import type { StoryAction, StoryPanelView as StoryPanelViewModel } from "./helpers";
import { StoryClaimStrip } from "./story-claim-strip";
import type { StoryActionId } from "./types";
import { type StoryPanelOptions, useStoryPanel } from "./use-story-panel";

import "./story-panel.css";

interface StoryActionButtonProps {
  action: StoryAction;
  onAction: (id: StoryActionId) => void;
}
const StoryActionButton = ({ action, onAction }: StoryActionButtonProps) => (
  <button className={action.className} disabled={action.disabled} type="button" onClick={() => onAction(action.id)}>
    {action.label}
  </button>
);

interface StoryPanelViewProps {
  view: StoryPanelViewModel;
  onAction: (id: StoryActionId) => void;
}
/** The story card: caption, title, page counter, the image floated beside the text, the claim strip, actions. */
export const StoryPanelView = ({ view, onAction }: StoryPanelViewProps) => (
  <Popup
    actions={view.actions.map(action => <StoryActionButton action={action} key={action.id} onAction={onAction} />)}
    className="story-panel"
    focusKey={view.focusKey}
    labelledBy={STORY_PANEL_TITLE_ID}
    tone={view.tone}
  >
    <header className="story-panel__header">
      <p className="story-panel__caption">{view.caption}</p>
      <h2 id={STORY_PANEL_TITLE_ID}>{view.title}</h2>
      {view.page && <span aria-label={view.page.label} className="story-panel__page">{view.page.short}</span>}
    </header>
    <div className="story-panel__body" key={view.pageKey}>
      {view.hasImage && (
        <CampaignImage className="story-panel__image" source={view.imageSource}>
          <img alt="" draggable={false} src={view.imageFallback} />
        </CampaignImage>
      )}
      {view.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
    </div>
    {view.claim && <StoryClaimStrip claim={view.claim} />}
  </Popup>
);

/** An intro or epilogue story panel; the owner provides the backdrop (`.settlement-popup`) and the content key. */
export const StoryPanel = (props: StoryPanelOptions) => {
  const { onAction, view } = useStoryPanel(props);
  return <StoryPanelView view={view} onAction={onAction} />;
};
