import { useState } from "react";

import { IconButton } from "../../components/icon-button";
import { WareIcon } from "../../components/ware-icon";
import { PREFERENCES } from "../../preferences/keys";
import { definePreference } from "../../preferences/registry";
import type { ReliefQuestDetails } from "./relief-helpers";

import "./relief-details.css";

/** Stored as "shown"/"hidden"; shown unless hidden. */
const illustrationsShown = definePreference(PREFERENCES.questIllustrations, {
  decode: raw => raw !== "hidden",
  encode: (visible: boolean) => visible ? "shown" : "hidden"
});
const useReliefIllustration = (details: ReliefQuestDetails) => {
  const [visible, setVisible] = useState(() => illustrationsShown.read());
  const toggle = () => setVisible(value => {
    illustrationsShown.write(!value);
    return !value;
  });
  if (visible) return { label: details.hideImage, toggle, visible };
  return { label: details.showImage, toggle, visible };
};

interface ReliefDetailsProps { details: ReliefQuestDetails }
/** Compact artwork stays beside the story; status and paid cargo remain readable in the quest. */
export const ReliefDetails = ({ details }: ReliefDetailsProps) => {
  const illustration = useReliefIllustration(details);
  return (
    <section className="quest-relief" data-relief-stage={details.stage}>
      <div className="quest-relief__story">
        {illustration.visible && <img alt={details.title} className="quest-relief__illustration"
          decoding="async" src={details.image} />}
        <IconButton className="quest-relief__image-toggle" icon="map" label={illustration.label}
          pressed={illustration.visible} onClick={illustration.toggle} />
        <h3>{details.title}</h3>
        <p>{details.text}</p>
      </div>
      <div aria-live="polite" className="quest-relief__status" role="status">
        <strong className="quest-relief__stage">{details.stageLabel}</strong>
        {details.blocker && <small>{details.blocker}</small>}
        <small>{details.loaded}</small>
      </div>
      <div aria-label={details.paymentLabel} className="quest-relief__payment" title={details.paymentText}>
        <small>{details.paymentLabel}</small>
        <WareIcon title={details.paymentText} ware={details.ware} />
        <strong>{details.amount}</strong>
      </div>
      <small>{details.hint}</small>
    </section>
  );
};
