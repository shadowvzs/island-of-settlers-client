import { useExternalStore } from "../../components/external-store";
import type { ScenarioSpaceEditor } from "../scenario-space-editor";

/** Evidence attributes are absent until an inspection reports them (review drivers wait for them). */
const toDataAttribute = (value: string) => value || undefined;

/** The connectivity inspection's state with its evidence attributes. */
export const useScenarioSpace = (editor: ScenarioSpaceEditor) => {
  const view = useExternalStore(editor.section);
  return {
    authoredValidation: toDataAttribute(view.authoredValidation),
    busy: view.busy,
    findings: view.findings,
    startupSpatial: toDataAttribute(view.startupSpatial),
    summary: view.summary
  };
};
