import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../shared/i18n/translate";
import { SettlementIcon } from "../../components/settlement-icon";
import { Tabs } from "../../components/tabs";
import { WareIcon } from "../../components/ware-icon";
import { WorkerPortrait } from "../building-details/worker-portrait";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiStore } from "../ui-store";
import type { getSummaryPeopleView, getSummaryResourceRows } from "./helpers";
import { useSettlementSummary } from "./use-settlement-summary";

type WorkerRow = ReturnType<typeof getSummaryPeopleView>["workers"][number];
type MilitaryRow = ReturnType<typeof getSummaryPeopleView>["military"][number];

interface SettlementSummaryViewProps {
  people: ReturnType<typeof getSummaryPeopleView>;
  resources: ReturnType<typeof getSummaryResourceRows>;
}

const ResourceGrid = ({ resources }: Pick<SettlementSummaryViewProps, "resources">) => {
  const { i18n } = useLingui();
  return (
  <div aria-label={i18n._(M.summary.resources)} className="settlement-ui__resources">
    {resources.map(({ label, name, value, ware }) => (
      <span aria-label={label} key={ware} title={label}>
        <WareIcon ware={ware} />
        <small>{name}</small>
        <b>{value}</b>
      </span>
    ))}
  </div>
  );
};

const WorkerCell = ({ cell }: { cell: WorkerRow }) => (
  <div aria-label={cell.title} data-count={cell.count} data-job={cell.job} title={cell.title}>
    <span className="settlement-ui__people-worker-portrait">
      <WorkerPortrait job={cell.job} />
      {cell.badge && (
        <span className="settlement-ui__people-tool">
          <WareIcon ware={cell.badge} />
        </span>
      )}
    </span>
    <small>{cell.label}</small>
    <b>{cell.count}</b>
  </div>
);

const MilitaryCell = ({ row }: { row: MilitaryRow }) => (
  <div aria-label={row.title} data-count={row.count} data-troop={row.type} title={row.title}>
    <img alt="" draggable={false} loading="eager" src={row.icon} />
    <small>{row.label}</small>
    <b>{row.count}</b>
  </div>
);

const PeopleView = ({ people }: Pick<SettlementSummaryViewProps, "people">) => {
  const { i18n } = useLingui();
  return (
  <div className="settlement-ui__people">
    <section aria-label={i18n._(M.summary.settlers)} className="settlement-ui__people-group">
      <h3>{i18n._(M.summary.settlers)}</h3>
      <div className="settlement-ui__people-grid">
        <div aria-label={translateMessage(i18n, M.summary.populationLabel, { value: people.population })}
          title={i18n._(M.summary.population)}>
          <SettlementIcon name="people" />
          <small>{i18n._(M.summary.population)}</small>
          <b>{people.population}</b>
        </div>
        <div aria-label={translateMessage(i18n, M.summary.idleLabel, { value: people.idleSettlers })}
          title={i18n._(M.summary.idle)}>
          <SettlementIcon name="people" />
          <small>{i18n._(M.summary.idle)}</small>
          <b>{people.idleSettlers}</b>
        </div>
      </div>
    </section>
    <section aria-label={i18n._(M.summary.workers)} className="settlement-ui__people-group">
      <h3>{i18n._(M.summary.workers)}</h3>
      {people.workers.length > 0 && (
        <div className="settlement-ui__people-grid">
          {people.workers.map(cell => <WorkerCell cell={cell} key={cell.job} />)}
        </div>
      )}
      {people.workers.length === 0 && <p className="settlement-ui__people-empty">{i18n._(M.summary.noWorkers)}</p>}
    </section>
    <section aria-label={i18n._(M.summary.military)} className="settlement-ui__people-group">
      <h3>{i18n._(M.summary.military)}</h3>
      {people.military.length > 0 && (
        <div className="settlement-ui__people-grid">
          {people.military.map(row => <MilitaryCell key={row.type} row={row} />)}
        </div>
      )}
      {people.military.length === 0 && <p className="settlement-ui__people-empty">{i18n._(M.summary.noSoldiers)}</p>}
    </section>
  </div>
  );
};

const SettlementSummaryView = ({ people, resources }: SettlementSummaryViewProps) => {
  const { i18n } = useLingui();
  return (
  <Tabs
    idPrefix="settlement-overview"
    items={[
      { content: <ResourceGrid resources={resources} />, id: "goods", label: i18n._(M.summary.goods) },
      { content: <PeopleView people={people} />, id: "people", label: i18n._(M.summary.settlers) }
    ]}
    label={i18n._(M.summary.sections)}
    listClassName="settlement-ui__tabs settlement-ui__summary-tabs"
    panelClassName="settlement-ui__summary-panel"
    tabClassName="settlement-ui__tab"
  />
  );
};

interface SettlementSummaryProps {
  store: SettlementUiStore;
  visibility: SettlementWindowVisibilityStore;
}
/** Settlement overview: the realm's goods and the people who live and work on the island. */
export const SettlementSummary = ({ store, visibility }: SettlementSummaryProps) => (
  <SettlementSummaryView {...useSettlementSummary(store, visibility)} />
);
