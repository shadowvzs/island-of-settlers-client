import { useLingui } from "@lingui/react";

import type { AdventureTheme } from "../../../shared/settlement/adventure-themes";
import { Checkbox } from "../../components/checkbox";
import { Section } from "../../components/section";
import { Select } from "../../components/select";
import { SwatchPicker } from "../../components/swatch-picker";
import { useSetting } from "../../components/use-setting";
import { MilitaryAiDebugSection } from "../../settlement/military-ai-debug/military-ai-debug-section";
import { MilitaryDebugSection } from "../../settlement/military-debug/military-debug-section";
import {
  type ExpeditionDiscoveryDebug,
  getMonthChoices,
  getThemeChoices
} from "../expedition-discovery-debug";
import { GlobalSeasonSection } from "../seasonal-appearance/global-season-section";
import { WeatherSection } from "../sections/weather-section";
import { type DevelopmentSection, getWorkerColorChoices } from "./helpers";
import { DEVELOPMENT_MESSAGES as M } from "./messages";
import { PlayerNationControl } from "./player-nation-control";

type SectionOf<K extends DevelopmentSection["kind"]> = Omit<Extract<DevelopmentSection, { kind: K }>, "kind">;

interface ExpeditionDiscoverySectionProps {
  debug: ExpeditionDiscoveryDebug;
}
/** Month and island theme overrides of debug discoveries. */
const ExpeditionDiscoverySection = ({ debug }: ExpeditionDiscoverySectionProps) => {
  const { i18n } = useLingui();
  const [month, setMonth] = useSetting(debug.month(), debug.setMonth);
  const [theme, setTheme] = useSetting<AdventureTheme | "">(debug.theme(), debug.setTheme);
  return (
    <Section title={i18n._(M.section.expeditionDiscovery)}>
      <Select choices={getMonthChoices(i18n)} label={i18n._(M.section.month)} selected={month} onChange={setMonth} />
      <Select choices={getThemeChoices(i18n)} label={i18n._(M.section.islandTheme)} selected={theme}
        onChange={setTheme} />
      <p>{i18n._(M.section.themeNote)}</p>
    </Section>
  );
};

const RevealOreSection = ({ checked, onChange }: SectionOf<"reveal-ore">) => {
  const { i18n } = useLingui();
  const [value, change] = useSetting(checked, onChange);
  return (
    <Section title={i18n._(M.section.debugVisibility)}>
      <Checkbox checked={value} label={i18n._(M.section.revealOre)} onChange={change} />
    </Section>
  );
};

/** Worker appearance controls, including a shared live nation selection. */
const WorkersSection = ({ color, onColorChange, onNationChange }: SectionOf<"workers">) => {
  const { i18n } = useLingui();
  const [value, change] = useSetting(color, onColorChange);
  return (
    <Section title={i18n._(M.section.workers)}>
      <PlayerNationControl onNationChange={onNationChange} />
      <SwatchPicker choices={getWorkerColorChoices(i18n)} label={i18n._(M.section.workerColour)}
        selected={value} onChange={change} />
    </Section>
  );
};

interface DevelopmentSectionViewProps {
  section: DevelopmentSection;
}
/** One control section of a development tab, by kind. */
export const DevelopmentSectionView = ({ section }: DevelopmentSectionViewProps) => {
  if (section.kind === "global-appearance") return <GlobalSeasonSection />;
  if (section.kind === "expedition-discovery") return <ExpeditionDiscoverySection debug={section.debug} />;
  if (section.kind === "military-ai") return <MilitaryAiDebugSection debug={section.debug} />;
  if (section.kind === "military-debug") return <MilitaryDebugSection debug={section.debug} />;
  if (section.kind === "reveal-ore") return <RevealOreSection checked={section.checked} onChange={section.onChange} />;
  if (section.kind === "weather") return <WeatherSection weather={section.weather} />;
  return <WorkersSection color={section.color} onColorChange={section.onColorChange}
    onNationChange={section.onNationChange} />;
};
