import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import { WareIcon } from "../../components/ware-icon";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { WorkerPortrait } from "./worker-portrait";
import { getWorkforceCells } from "./workforce-helpers";

type WorkforceCell = ReturnType<typeof getWorkforceCells>[number];

interface ToolBadgeProps {
  ware: string;
}
const ToolBadge = ({ ware }: ToolBadgeProps) => (
  <span className="settlement-ui__worker-tool">
    <WareIcon ware={ware} />
  </span>
);

interface WorkforceCellViewProps {
  cell: WorkforceCell;
}
const WorkforceCellView = ({ cell }: WorkforceCellViewProps) => (
  <div aria-label={cell.title} data-count={cell.count} data-job={cell.job} title={cell.title}>
    <span className="settlement-ui__worker-portrait">
      <WorkerPortrait job={cell.job} />
      {cell.badge && <ToolBadge ware={cell.badge} />}
    </span>
    <small>{cell.label}</small>
    <b>{cell.count}</b>
  </div>
);

interface WorkforceSectionProps {
  availableSettlers?: number;
  workforce?: Readonly<Record<string, number>>;
}
/** Settlers page of a depot: settlers recruited here per job and the idle settlers stored here. */
export const WorkforceSection = ({ availableSettlers, workforce }: WorkforceSectionProps) => {
  const { i18n } = useLingui();
  const cells = useMemo(() => getWorkforceCells(workforce, availableSettlers, i18n),
    [availableSettlers, i18n, workforce]);
  return (
    <section
      aria-label={i18n._(M.details.workforce.aria)}
      className="settlement-ui__inventory settlement-ui__workforce-inventory"
    >
      <h3>{i18n._(M.details.workforce.heading)}</h3>
      <p>{i18n._(M.details.workforce.note)}</p>
      <div className="settlement-ui__inventory-grid">
        {cells.map(cell => <WorkforceCellView cell={cell} key={cell.job} />)}
      </div>
    </section>
  );
};
