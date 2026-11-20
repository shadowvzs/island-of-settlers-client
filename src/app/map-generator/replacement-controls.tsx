import { useLingui } from "@lingui/react";

import { translateMessage } from "../../shared/i18n/translate";
import type { WorldData } from "../../shared/world/world-data";
import { Checkbox } from "../components/checkbox";
import { Select } from "../components/select";
import { MAP_EDITOR_MESSAGES as M } from "../map-editor/messages";
import { ActionButton, ActionRow } from "../map-editor/panel/fields";
import type { IslandChoice } from "./helpers";
import { getResourcePresetOptions } from "./options";
import { useReplacementControls } from "./use-replacement-controls";

interface ReplacementControlsProps {
  onGenerate?: (choice: IslandChoice, seed?: number) => void;
  world: WorldData;
}
/** The editor's explicit replacement map: the open map's dimensions and seed with a chosen resource preset. */
export const ReplacementControls = ({ onGenerate: apply, world }: ReplacementControlsProps) => {
  const { i18n } = useLingui();
  const { cliffBands, tier, onCliffBandsChange, onGenerate, onTierChange } = useReplacementControls(world, apply);
  return (
    <div>
      <Select choices={getResourcePresetOptions(i18n)}
        label={translateMessage(i18n, M.replacement.resources)} selected={tier} onChange={onTierChange} />
      <Checkbox checked={cliffBands} label={translateMessage(i18n, M.replacement.cliffBands)}
        onChange={onCliffBandsChange} />
      <ActionRow>
        <ActionButton caption={M.replacement.generateCaption} icon="action:musicRepeat"
          label={M.replacement.generateLabel} onClick={onGenerate} />
      </ActionRow>
    </div>
  );
};
