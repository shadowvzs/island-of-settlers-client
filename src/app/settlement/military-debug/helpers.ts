import type { ExternalStore } from "../../components/ui-store";
import type { DevelopmentTool } from "../../settings/development/helpers";

/** Development tools > Military: the settlement's debug tools (once a settlement exists). */
export interface MilitaryDebugControls {
  /** Hidden while the player views a conquered colony. */
  hidden: ExternalStore<boolean>;
  tools: readonly DevelopmentTool[];
}

/** Publishes a tool's disabled state only when it changes (the tick runs every 0.5 s). */
export const setToolDisabled = (tool: DevelopmentTool, disabled: boolean) => {
  if (tool.state.getSnapshot().disabled !== disabled) tool.update({ disabled });
};
