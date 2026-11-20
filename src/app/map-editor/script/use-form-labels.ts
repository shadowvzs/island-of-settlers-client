import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../shared/i18n/translate";
import { SCRIPT_MESSAGES as M } from "./messages";

/** The trigger form's fixed texts in the active locale (cheap lookups; rebuilt with each render). */
export const useFormLabels = () => {
  const { i18n } = useLingui();
  const text = (descriptor: Parameters<typeof translateMessage>[1]) => translateMessage(i18n, descriptor);
  return {
      addAction: text(M.form.addAction), addCondition: text(M.form.addCondition), addEvent: text(M.form.addEvent),
      advanced: text(M.form.advanced), checkConditions: text(M.form.checkConditions), comment: text(M.form.comment),
      concurrency: text(M.form.concurrency), copyTrigger: text(M.form.copyTrigger),
      deleteTrigger: text(M.form.deleteTrigger), do: text(M.form.do), elseBranch: text(M.form.elseBranch),
      enabled: text(M.form.enabled), explain: text(M.form.explain), folder: text(M.form.folder), if: text(M.form.if),
      lockOrders: text(M.form.lockOrders), loopBody: text(M.form.loopBody), name: text(M.form.name),
      noEvents: text(M.form.noEvents), none: text(M.form.none), pasteStep: text(M.form.pasteStep),
      runLimit: text(M.form.runLimit), runLimitHint: text(M.form.runLimitHint),
      runTriggerHint: text(M.form.runTriggerHint), stepComment: text(M.form.stepComment),
      stopOnFail: text(M.form.stopOnFail), thenBranch: text(M.form.thenBranch), unset: text(M.value.unset),
      any: text(M.value.any), waitDone: text(M.form.waitDone), waitForRun: text(M.form.waitForRun),
      waitTimeout: text(M.form.waitTimeout), when: text(M.form.when),
      menu: {
        comment: text(M.menu.comment), copy: text(M.menu.copy), cut: text(M.menu.cut), delete: text(M.menu.delete),
        disable: text(M.menu.disable), duplicate: text(M.menu.duplicate), enable: text(M.menu.enable),
        invert: text(M.menu.invert), invertHint: text(M.menu.invertHint), label: text(M.menu.label),
        moveDown: text(M.menu.moveDown), moveUp: text(M.menu.moveUp), off: text(M.menu.off),
        wrapForEach: text(M.menu.wrapForEach), wrapIf: text(M.menu.wrapIf)
      }
  };
};

export type FormLabels = ReturnType<typeof useFormLabels>;
