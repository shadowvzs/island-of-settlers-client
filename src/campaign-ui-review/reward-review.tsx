import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import { PopupView } from "../app/settlement-ui/popup/popup-view";
import { RewardIcons } from "../app/settlement-ui/reward-icons/reward-icons";
import { getReviewPopup, getRewardGallery } from "./reward-fixtures";

/** Every reward kind in the shared reward row: default and compact variants, nation and fallbacks. */
export const RewardGalleryReview = () => {
  const { i18n } = useLingui();
  const rows = useMemo(() => getRewardGallery(i18n), [i18n]);
  return (
    <div className="settlement-ui__panel review__reward-gallery">
      {rows.map(row => (
        <section key={row.title}>
          <h3>{row.title}</h3>
          <RewardIcons className={row.className} view={row.view} />
        </section>
      ))}
    </div>
  );
};

interface RewardPopupReviewProps {
  kind: "level-up-popup" | "reward-popup";
}
/** A settlement reward popup (won adventure or level-up) on the real popup card. */
export const RewardPopupReview = ({ kind }: RewardPopupReviewProps) => {
  const { i18n } = useLingui();
  const view = useMemo(() => getReviewPopup(kind, i18n), [i18n, kind]);
  return (
    <div className="settlement-popup">
      <PopupView revision={1} view={view} onAction={() => undefined} />
    </div>
  );
};
