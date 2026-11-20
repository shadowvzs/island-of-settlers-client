import type { MessageDescriptor } from "@lingui/core";
import { useLingui } from "@lingui/react";

import { Checkbox } from "../../components/checkbox";
import { Section } from "../../components/section";
import { SETTINGS_MESSAGES } from "./messages";
import { useWorldSettings, type WorldSettingsOptions } from "./use-section-settings";

interface WorldSectionViewProps {
  critters: boolean;
  fog: boolean;
  fogLocked: boolean;
  fogTitle: MessageDescriptor;
  onCrittersChange: (enabled: boolean) => void;
  onFogChange: (visible: boolean) => void;
}
const WorldSectionView = ({
  critters, fog, fogLocked, fogTitle, onCrittersChange, onFogChange
}: WorldSectionViewProps) => {
  const { i18n } = useLingui();
  return (
    <Section icon="map" title={i18n._(SETTINGS_MESSAGES.world.title)}>
      <Checkbox checked={critters} label={i18n._(SETTINGS_MESSAGES.world.critters)} onChange={onCrittersChange} />
      <Checkbox
        checked={fog}
        disabled={fogLocked}
        label={i18n._(SETTINGS_MESSAGES.world.fog)}
        title={i18n._(fogTitle)}
        onChange={onFogChange}
      />
    </Section>
  );
};

/** Decorative critters and the reversible fog of war display. */
export const WorldSection = (props: WorldSettingsOptions) => <WorldSectionView {...useWorldSettings(props)} />;
