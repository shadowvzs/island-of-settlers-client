import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../shared/i18n/translate";
import { Checkbox } from "../../components/checkbox";
import { LOWER_TOGGLE, RELIEF_TOOLS, TERRAIN_TOOLS } from "../editor-catalog";
import type { EditorStore } from "../editor-store";
import { MAP_EDITOR_MESSAGES as M } from "../messages";
import { EditorSection, NumberField, ToolButton } from "./fields";
import { toEntrySpec } from "./helpers";
import { TOOL_CLASS, ToolGrid } from "./tool-grid";
import { useLowerMode, useTerrainOptions } from "./use-editor-store";

const RELIEF_SPECS = RELIEF_TOOLS.map(toEntrySpec);
const TERRAIN_SPECS = TERRAIN_TOOLS.map(toEntrySpec);

interface StoreProps {
  store: EditorStore;
}

const LowerToggle = ({ store }: StoreProps) => {
  const lowerMode = useLowerMode(store);
  return <ToolButton action={LOWER_TOGGLE} active={lowerMode} className={TOOL_CLASS} pressed={lowerMode}
    onClick={store.toggleLowerMode} />;
};

/** Mountain, alpine mountain, lake and reset stamps with the Lower toggle (trackpads, touch). */
export const ReliefSection = ({ store }: StoreProps) => (
  <EditorSection info={M.help.relief} title={M.sections.relief}>
    <ToolGrid specs={RELIEF_SPECS} store={store}><LowerToggle store={store} /></ToolGrid>
  </EditorSection>
);

/** Gentle brushes, target height and coast protection. */
export const TerrainBrushSection = ({ store }: StoreProps) => {
  const { i18n } = useLingui();
  const { height, protectCoast, onProtectCoast } = useTerrainOptions(store);
  return (
    <EditorSection info={M.help.terrain} title={M.sections.terrain}>
      <ToolGrid specs={TERRAIN_SPECS} store={store} />
      <NumberField
        className="settings-panel__select"
        label={M.fields.targetHeight}
        max="64"
        min="-32"
        step=".1"
        value={height.text}
        onBlur={height.onBlur}
        onChange={height.onChange}
      />
      <Checkbox checked={protectCoast} label={translateMessage(i18n, M.fields.protectCoast)}
        onChange={onProtectCoast} />
    </EditorSection>
  );
};
