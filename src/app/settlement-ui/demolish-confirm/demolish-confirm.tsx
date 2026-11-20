import { useLingui } from "@lingui/react";
import type { RefObject } from "react";

import { BuildingIcon } from "../../components/building-icon";
import {
  type DemolishConfirmation, type DemolishQuestion, getDemolishChoiceLabels, getDemolishConfirmationText
} from "../demolish-confirmation-helpers";
import { useDemolishConfirm } from "./use-demolish-confirm";

interface DemolishQuestionViewProps {
  keepRef: RefObject<HTMLButtonElement | null>;
  question: DemolishQuestion;
  onConfirm: () => void;
  onKeep: () => void;
}
const DemolishQuestionView = ({ keepRef, question, onConfirm, onKeep }: DemolishQuestionViewProps) => {
  const { i18n } = useLingui();
  const text = getDemolishConfirmationText(question.name, question.completed, i18n);
  const labels = getDemolishChoiceLabels(question, i18n);
  return (
    <>
      <div className="settlement-ui__demolish-subject">
        <span className="settlement-ui__demolish-icon">
          <BuildingIcon type={question.type} />
        </span>
        <div>
          <strong>{question.name}</strong>
          <p className="settlement-ui__demolish-question">{text.question}</p>
        </div>
      </div>
      <div className="settlement-ui__demolish-choices">
        <button
          aria-label={labels.keep}
          className="settlement-ui__button settlement-ui__demolish-choice"
          data-demolish-confirm-no={question.uid}
          ref={keepRef}
          type="button"
          onClick={onKeep}
        >
          {text.keepLabel}
        </button>
        <button
          aria-label={labels.confirm}
          className="settlement-ui__button settlement-ui__demolish-choice settlement-ui__demolish-choice--danger"
          data-demolish-confirm-yes={question.uid}
          type="button"
          onClick={onConfirm}
        >
          {text.confirmLabel}
        </button>
      </div>
    </>
  );
};

interface DemolishConfirmProps {
  confirmation: DemolishConfirmation;
  onDemolish: (uid: number) => void;
}
/** Asks before a demolition (owner decision 2026-10-12); it never blocks the map. */
export const DemolishConfirm = ({ confirmation, onDemolish }: DemolishConfirmProps) => {
  const { keepRef, question } = useDemolishConfirm(confirmation);
  if (!question) return null;
  return (
    <DemolishQuestionView
      keepRef={keepRef}
      question={question}
      onConfirm={() => {
        if (confirmation.confirm(question.uid)) onDemolish(Number(question.uid));
      }}
      onKeep={confirmation.cancel}
    />
  );
};
