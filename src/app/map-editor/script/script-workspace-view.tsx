import { Tabs } from "../../components/tabs";
import { ActorPanel } from "./actor-panel";
import { ScriptIconButton } from "./icon-button";
import { BoardPanel } from "./multiboards/board-panel";
import { QuestPanel } from "./quests/quest-panel";
import { AddMenu } from "./script-dialog";
import type { ScriptWorkspace } from "./script-workspace";
import { SlotPicker } from "./slot-picker";
import { TemplateDialog } from "./template-dialog";
import { TriggerFormHost } from "./trigger-form";
import { TriggerList } from "./trigger-list";
import { type ScriptDialogs, useScriptDialogs } from "./use-script-dialogs";
import { useSelectedTrigger, useWorkspaceHeader } from "./use-script-workspace";
import { VariablePanel } from "./variables/variable-panel";

import "./script-workspace.css";

interface WorkspacePartProps {
  dialogs: ScriptDialogs;
  workspace: ScriptWorkspace;
}

/** Validation status, the last notice and undo/redo of script edits. */
const WorkspaceHeader = ({ workspace }: Pick<WorkspacePartProps, "workspace">) => {
  const view = useWorkspaceHeader(workspace);
  return (
    <div className="script-workspace__header">
      <p className="script-workspace__status" data-ready={view.ready} role="status">{view.status}</p>
      {view.notice && <p className="script-workspace__notice" data-refusal={view.noticeIsRefusal}>{view.notice}</p>}
      <div className="script-workspace__history">
        {view.canTestPlay && (
          <ScriptIconButton className="script-workspace__test-play" icon="testPlay" label={view.testPlayLabel}
            onClick={view.onTestPlay} />
        )}
        <ScriptIconButton disabled={!view.canUndo} icon="undo" label={view.undoLabel} onClick={view.onUndo} />
        <ScriptIconButton disabled={!view.canRedo} icon="redo" label={view.redoLabel} onClick={view.onRedo} />
      </div>
    </div>
  );
};

/** Triggers: the list on the left, the selected trigger's form on the right (stacked on a phone). */
const TriggersTab = ({ dialogs, workspace }: WorkspacePartProps) => {
  const trigger = useSelectedTrigger(workspace);
  return (
    <div className="script-workspace__triggers">
      <TriggerList workspace={workspace} onOpenTemplates={dialogs.openTemplates} />
      <TriggerFormHost dialogs={dialogs} trigger={trigger} workspace={workspace} />
    </div>
  );
};

const WorkspaceDialogs = ({ dialogs, workspace }: WorkspacePartProps) => (
  <>
    {dialogs.picker && <SlotPicker request={dialogs.picker} workspace={workspace} onClose={dialogs.closePicker} />}
    {dialogs.add && <AddMenu request={dialogs.add} workspace={workspace} onClose={dialogs.closeAdd} />}
    {dialogs.templates && <TemplateDialog workspace={workspace} onClose={dialogs.closeTemplates} />}
  </>
);

interface ScriptWorkspaceViewProps {
  workspace: ScriptWorkspace;
}
/**
 * The Script workspace (design §13.1): Triggers, Quests, Variables, Actors and Multiboards tabs, dialogs layered
 * inside the window.
 */
export const ScriptWorkspaceView = ({ workspace }: ScriptWorkspaceViewProps) => {
  const dialogs = useScriptDialogs();
  const header = useWorkspaceHeader(workspace);
  return (
    <div className="script-workspace">
      <WorkspaceHeader workspace={workspace} />
      <Tabs idPrefix="script-workspace" items={[
        { content: <TriggersTab dialogs={dialogs} workspace={workspace} />, id: "triggers",
          label: header.tabs.triggers },
        { content: <QuestPanel dialogs={dialogs} workspace={workspace} />, id: "quests", label: header.tabs.quests },
        { content: <VariablePanel workspace={workspace} />, id: "variables", label: header.tabs.variables },
        { content: <ActorPanel dialogs={dialogs} workspace={workspace} />, id: "actors", label: header.tabs.actors },
        { content: <BoardPanel dialogs={dialogs} workspace={workspace} />, id: "boards", label: header.tabs.boards }
      ]} label={header.tabsLabel} listClassName="script-workspace__tabs" panelClassName="script-workspace__panel"
      request={header.tabRequest} tabClassName="script-workspace__tab" />
      <WorkspaceDialogs dialogs={dialogs} workspace={workspace} />
    </div>
  );
};
