import { useLingui } from "@lingui/react";
import { Fragment } from "react";

import { BuildingIcon } from "../../components/building-icon";
import { IconButton } from "../../components/icon-button";
import { WareIcon } from "../../components/ware-icon";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { progressionIcon } from "../player-hud-helpers";
import { RewardIcons } from "../reward-icons/reward-icons";
import { type DailyQuestDetails, type QuestDetails, type QuestIconSource, type TutorialQuestDetails } from "./helpers";
import { ReliefDetails } from "./relief-details";

const claimLabel = (confirming: boolean, i18n: ReturnType<typeof useLingui>["i18n"]) => {
  if (confirming) return i18n._(M.quests.confirming);
  return i18n._(M.quests.claim);
};

interface QuestIconProps {
  icon: QuestIconSource;
}
/** A tutorial building, a feature's rendered icon or the quest's ware. */
export const QuestIcon = ({ icon }: QuestIconProps) => {
  if ("building" in icon) return <BuildingIcon type={icon.building} />;
  if ("image" in icon) return <img alt="" aria-hidden="true" draggable={false} src={icon.image} />;
  return <WareIcon ware={icon.ware} />;
};

const QuestArt = ({ icon }: QuestIconProps) => (
  <span className="quest-window__art"><QuestIcon icon={icon} /></span>
);

interface ClaimButtonProps {
  disabled: boolean;
  label: string;
  onClick: () => void;
}
/** The quest scroll stands in for the button's icon. */
const ClaimButton = ({ disabled, label, onClick }: ClaimButtonProps) => (
  <button
    aria-label={label}
    className="settlement-ui__button"
    disabled={disabled}
    title={label}
    type="button"
    onClick={onClick}
  >
    <img alt="" draggable={false} src={progressionIcon("quest-scroll")} />
    <span>{label}</span>
  </button>
);

interface DailyDetailsProps {
  details: DailyQuestDetails;
  onClaim: (id: string) => void;
}
const DailyDetails = ({ details, onClaim }: DailyDetailsProps) => (
  <article className="quest-window__details">
    {details.relief && <ReliefDetails details={details.relief} />}
    {!details.relief && <>
      <QuestArt icon={{ ware: details.ware }} />
      <h3>{details.title}</h3>
      <p className="settlement-ui__section-description">{details.goal}</p>
      <small>{details.progressText}</small>
      <span className="player-hud__bar"><i style={{ width: details.percent }} /></span>
    </>}
    <div className="quest-window__claim">
      <RewardIcons className="reward-icons--compact" view={details.rewards} />
      <ClaimButton
        disabled={details.claimDisabled}
        label={details.claimLabel}
        onClick={() => onClaim(details.id)}
      />
    </div>
  </article>
);

interface TutorialDetailsProps {
  details: TutorialQuestDetails;
  onClaim: (id: string) => void;
  onShow: (id: string) => void;
  onSkip: (id: string) => void;
}
const TutorialDetails = ({ details, onClaim, onShow, onSkip }: TutorialDetailsProps) => {
  const { i18n } = useLingui();
  return (
  <article className="quest-window__details">
    <QuestArt icon={details.icon} />
    <p className="quest-window__chapter">{details.chapter.chapter}</p>
    <h3>{details.title}</h3>
    <p>{details.chapter.step} · {details.progressText}</p>
    {details.notes.map(note => (
      <Fragment key={note.label}>
        <strong>{note.label}</strong>
        <p>{note.text}</p>
      </Fragment>
    ))}
    {details.showHomeNote && <p>{i18n._(M.quests.homeNote)}</p>}
    {details.showMissingNote && <p>{i18n._(M.quests.missingNote)}</p>}
    <p className="quest-window__chapter-reward">{details.chapterReward}</p>
    <div className="quest-window__claim">
      <RewardIcons className="reward-icons--compact" view={details.rewards} />
      <IconButton
        caption={claimLabel(details.confirming, i18n)}
        disabled={details.claimDisabled}
        icon="build"
        label={claimLabel(details.confirming, i18n)}
        onClick={() => onClaim(details.id)}
      />
      <IconButton
        caption={i18n._(M.quests.showMe)}
        disabled={details.showDisabled}
        icon="build"
        label={i18n._(M.quests.showMe)}
        onClick={() => onShow(details.id)}
      />
      {details.skippable && (
        <IconButton
          caption={details.skipLabel}
          disabled={details.showDisabled}
          icon="cancel"
          label={details.skipLabel}
          onClick={() => onSkip(details.id)}
        />
      )}
    </div>
  </article>
  );
};

interface QuestDetailPaneProps {
  details: QuestDetails;
  onClaim: (id: string) => void;
  onShow: (id: string) => void;
  onSkip: (id: string) => void;
}
/** The selected quest, or the all-done note once today's quests are complete. */
export const QuestDetailPane = ({ details, onClaim, onShow, onSkip }: QuestDetailPaneProps) => {
  const { i18n } = useLingui();
  if (details.kind === "tutorial")
    return <TutorialDetails details={details} onClaim={onClaim} onShow={onShow} onSkip={onSkip} />;
  if (details.kind === "daily") return <DailyDetails details={details} onClaim={onClaim} />;
  return (
    <p className="settlement-ui__section-description quest-window__empty">{i18n._(M.quests.done)}</p>
  );
};
