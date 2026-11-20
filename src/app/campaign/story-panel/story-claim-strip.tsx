import { RewardIcons } from "../../settlement-ui/reward-icons/reward-icons";
import type { StoryClaimView } from "./helpers";

interface StoryClaimStripProps {
  claim: StoryClaimView;
}
/** The epilogue's claim result: the status line, then the granted experience and rewards (shared reward row). */
export const StoryClaimStrip = ({ claim }: StoryClaimStripProps) => (
  <div aria-label={claim.label} aria-live="polite" className="story-panel__claim" data-status={claim.status}
    role="group">
    <p className="story-panel__claim-message">{claim.message}</p>
    {claim.rewards && <RewardIcons view={claim.rewards} />}
  </div>
);
