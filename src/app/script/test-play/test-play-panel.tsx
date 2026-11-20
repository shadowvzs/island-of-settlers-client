import { memo } from "react";

import type { MapScript } from "../../../../../island-of-settlers-shared/src/script/types/script";
import { LabelledButton } from "../../components/labelled-button";
import { SettlementIcon } from "../../components/settlement-icon";
import type { TestPlayLogRow } from "./helpers";
import type { TestPlayLog } from "./test-play-log";
import { useFollowNewest, useTestPlayPanel } from "./use-test-play-panel";

import "./test-play-panel.css";

interface PanelButtonProps {
  icon: string;
  label: string;
  pressed?: boolean;
  onClick: () => void;
}
/** A small square icon button of the log header; the label is its tooltip. */
const PanelButton = ({ icon, label, pressed, onClick }: PanelButtonProps) => (
  <LabelledButton className="test-play-log__button" label={label} pressed={pressed} onClick={onClick}>
    <SettlementIcon name={icon} />
  </LabelledButton>
);

interface LogRowProps {
  row: TestPlayLogRow;
}
const LogRowView = ({ row }: LogRowProps) => (
  <li className="test-play-log__row" data-kind={row.kind}>
    <time className="test-play-log__time">{row.time}</time>
    <span className="test-play-log__text">{row.text}</span>
  </li>
);
/** A published line never changes, so it renders once. */
const LogRow = memo(LogRowView);

interface LogListProps {
  rows: readonly TestPlayLogRow[];
}
const LogList = ({ rows }: LogListProps) => {
  const { list, onScroll } = useFollowNewest(rows.length);
  return (
    <ol className="test-play-log__list" ref={list} onScroll={onScroll}>
      {rows.map(row => <LogRow key={row.id} row={row} />)}
    </ol>
  );
};

export interface TestPlayPanelProps {
  log: TestPlayLog;
  script: MapScript | undefined;
}
/** The play-test debug log: fired triggers, run steps, quest state changes and variable writes with game time. */
export const TestPlayPanel = ({ log, script }: TestPlayPanelProps) => {
  const view = useTestPlayPanel(log, script);
  return (
    <section aria-label={view.title} className="test-play-log" data-expanded={view.expanded}>
      <header className="test-play-log__header">
        <h3 className="test-play-log__title">{view.title}</h3>
        {view.filters.map(filter => (
          <PanelButton icon={filter.icon} key={filter.kind} label={filter.label} pressed={filter.pressed}
            onClick={() => view.onToggleKind(filter.kind)} />
        ))}
        <PanelButton icon={view.clearIcon} label={view.clearLabel} onClick={view.onClear} />
        <PanelButton icon={view.collapseIcon} label={view.collapseLabel} onClick={view.onToggleCollapsed} />
      </header>
      {view.expanded && view.isEmpty && <p className="test-play-log__empty">{view.emptyText}</p>}
      {view.expanded && !view.isEmpty && <LogList rows={view.rows} />}
    </section>
  );
};
