import { EditorSection } from "../panel/fields";
import { SCRIPT_MESSAGES as M } from "./messages";
import type { ScriptWindow } from "./script-window";
import { useScriptSection } from "./use-script-section";

interface ScriptSectionProps {
  script: ScriptWindow;
}
/** The editor panel's Script category: what the map script holds, its Ready state, and the workspace opener. */
export const ScriptSection = ({ script }: ScriptSectionProps) => {
  const { registerOpener } = script;
  const view = useScriptSection(script);
  return (
    <EditorSection info={M.workspace.sectionInfo} title={M.workspace.title}>
      <p>{view.summary}</p>
      <p className="map-editor__script-status" data-ready={view.ready}>{view.status}</p>
      <button aria-haspopup="dialog" ref={registerOpener} type="button" onClick={view.onOpen}>{view.openLabel}</button>
    </EditorSection>
  );
};
