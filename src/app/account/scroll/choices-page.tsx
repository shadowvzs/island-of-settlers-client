import { AccountStatus } from "../form/account-status";
import { firstChoiceRef } from "./helpers";
import type { ChoicesOptions } from "./scroll-pages";
import { ScrollButton, ScrollHeading } from "./scroll-parts";
import { useChoicesPage } from "./use-choices-page";

/** A question on the scroll with one button per answer (the first takes the focus). */
export const ChoicesPage = ({ choices, lead, note, title }: ChoicesOptions) => {
  const { busy, firstRef, status, onChoose } = useChoicesPage(choices);
  return (
    <div className="account-scroll__sheet">
      <ScrollHeading lead={lead} title={title} />
      <div className="account-scroll__choices account-scroll__choices--list">
        {choices.map((choice, index) => (
          <ScrollButton
            buttonRef={firstChoiceRef(index, firstRef)}
            disabled={busy}
            key={choice.label}
            label={choice.label}
            type="button"
            onClick={() => onChoose(index)}
          />
        ))}
      </div>
      <AccountStatus className="account-scroll__status" status={status} />
      {note && <p className="account-scroll__note">{note}</p>}
    </div>
  );
};
