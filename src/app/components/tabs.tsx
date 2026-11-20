import type { KeyboardEvent, ReactNode } from "react";

import type { TabRow } from "./helpers";
import { type TabsOptions, useTabs } from "./use-tabs";

interface TabsViewProps {
  label: string;
  listClassName?: string;
  panelClassName?: string;
  tabClassName?: string;
  tabs: readonly TabRow<ReactNode>[];
  onTabKeyDown: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
  onTabSelect: (index: number) => void;
}
const TabsView = ({
  label, listClassName, panelClassName, tabClassName, tabs, onTabKeyDown, onTabSelect
}: TabsViewProps) => (
  <>
    <div aria-label={label} className={listClassName} role="tablist">
      {tabs.map(tab => (
        <button
          aria-controls={tab.panelId}
          aria-selected={tab.selected}
          className={tabClassName}
          data-ui-anchor={tab.anchor}
          id={tab.tabId}
          key={tab.id}
          role="tab"
          tabIndex={tab.tabIndex}
          type="button"
          onClick={() => onTabSelect(tab.index)}
          onKeyDown={event => onTabKeyDown(event, tab.index)}
        >
          {tab.label}
        </button>
      ))}
    </div>
    {tabs.map(tab => (
      <section
        aria-labelledby={tab.tabId}
        className={panelClassName}
        hidden={!tab.selected}
        id={tab.panelId}
        key={tab.id}
        role="tabpanel"
        tabIndex={0}
      >
        {tab.content}
      </section>
    ))}
  </>
);

type TabsProps = TabsOptions<ReactNode> & {
  label: string;
  listClassName?: string;
  panelClassName?: string;
  tabClassName?: string;
};
/**
 * ARIA tablist with roving tab index and arrow / Home / End keys. Every panel mounts once and only
 * hides, so controls keep their state and pending work across tab changes.
 */
export const Tabs = ({
  anchorPrefix, idPrefix, initialIndex, items, label, listClassName, panelClassName, request, tabClassName
}: TabsProps) => (
  <TabsView
    label={label}
    listClassName={listClassName}
    panelClassName={panelClassName}
    tabClassName={tabClassName}
    {...useTabs({ anchorPrefix, idPrefix, initialIndex, items, request })}
  />
);
