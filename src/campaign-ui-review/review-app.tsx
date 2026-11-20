import { useState } from "react";

import { SpeakerPanel } from "../app/campaign/cinematics/ui/speaker-panel";
import { StoryPanel } from "../app/campaign/story-panel/story-panel";
import type { StoryClaim } from "../app/campaign/story-panel/types";
import { DialogueSpeedSection } from "../app/settings/dialogue-speed/dialogue-speed-section";
import { useDialogueMsPerChar } from "../app/settings/dialogue-speed/use-dialogue-speed";
import { RETRY_DEMO_MS } from "./constants";
import { FIXTURE_ACTOR_SPEAKERS, GRANTED_CLAIM, resolveFixtureImage } from "./fixture-data";
import { initialReviewClaim, reviewLines, type ReviewOptions, reviewStoryContent } from "./helpers";
import { MultiboardReview } from "./multiboard-review";
import { RewardGalleryReview, RewardPopupReview } from "./reward-review";
import { useReviewDialogue } from "./use-review-dialogue";

const StoryReview = ({ view }: Pick<ReviewOptions, "view">) => {
  const [claim, setClaim] = useState<StoryClaim>(() => initialReviewClaim(view));
  const [closed, setClosed] = useState(false);
  const retry = () => {
    setClaim({ status: "pending" });
    window.setTimeout(() => setClaim(GRANTED_CLAIM), RETRY_DEMO_MS);
  };
  if (closed) {
    return <button className="review__again" type="button" onClick={() => setClosed(false)}>Show again</button>;
  }
  return (
    <div className="settlement-popup">
      <StoryPanel content={reviewStoryContent(view, claim)} resolveImage={resolveFixtureImage}
        onClose={() => setClosed(true)} onRetryClaim={retry} />
    </div>
  );
};

const SpeakerReview = ({ hold, view }: Pick<ReviewOptions, "hold" | "view">) => {
  const msPerChar = useDialogueMsPerChar();
  const [run, setRun] = useState(0);
  const [lines] = useState(() => reviewLines(view, hold));
  const { finished, onAdvance, ui } = useReviewDialogue(lines, FIXTURE_ACTOR_SPEAKERS, run);
  if (finished) {
    return (
      <button className="review__again" type="button" onClick={() => setRun(run + 1)}>
        Replay dialogue
      </button>
    );
  }
  return (
    <SpeakerPanel lines={ui.lines} msPerChar={msPerChar} resolvePortrait={resolveFixtureImage}
      speakers={ui.speakers} speech={ui.speech} onAdvance={onAdvance} />
  );
};

/**
 * Dev review page of the campaign story panel (C11a), the cinematic speaker panel (CIN5), the shared reward row
 * (reward icons) and the script multiboards (TRG8) on fixtures.
 */
export const ReviewApp = ({ hold, multiboard, view }: Pick<ReviewOptions, "hold" | "multiboard" | "view">) => {
  if (view === "multiboard") return <MultiboardReview options={multiboard} />;
  if (view === "reward-gallery") return <RewardGalleryReview />;
  if (view === "reward-popup" || view === "level-up-popup") return <RewardPopupReview kind={view} />;
  if (view === "settings") return <div className="settings-panel review__settings"><DialogueSpeedSection /></div>;
  if (view.startsWith("speaker")) return <SpeakerReview hold={hold} view={view} />;
  return <StoryReview view={view} />;
};
