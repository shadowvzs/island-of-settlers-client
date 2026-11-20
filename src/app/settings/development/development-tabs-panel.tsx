import { useLingui } from "@lingui/react";

import { Tabs } from "../../components/tabs";
import { DevelopmentSectionView } from "./development-sections";
import type { DevelopmentTabContent } from "./development-tabs";
import { DevelopmentToolGrid } from "./development-tool-grid";
import { DEVELOPMENT_MESSAGES as M, resolveDevelopmentText } from "./messages";

interface DevelopmentTabViewProps {
  tab: DevelopmentTabContent;
}
/** One development category: its tool grid, then its control sections. */
const DevelopmentTabView = ({ tab: { sections, tools } }: DevelopmentTabViewProps) => (
  <div>
    {tools && <DevelopmentToolGrid tools={tools} />}
    {sections.map((section, index) => <DevelopmentSectionView key={`${section.kind}-${index}`} section={section} />)}
  </div>
);

interface DevelopmentTabsProps {
  tabs: readonly DevelopmentTabContent[];
}
/** Development categories: React tools and sections, DOM controllers of other features hosted in place. */
export const DevelopmentTabs = ({ tabs }: DevelopmentTabsProps) => {
  const { i18n } = useLingui();
  return (
    <Tabs
      idPrefix="development"
      items={tabs.map(tab => ({
        content: <DevelopmentTabView tab={tab} />, id: tab.id, label: resolveDevelopmentText(i18n, tab.label)
      }))}
      label={i18n._(M.panel.categories)}
      listClassName="development-menu__tabs"
      panelClassName="development-menu__tab-content"
    />
  );
};
