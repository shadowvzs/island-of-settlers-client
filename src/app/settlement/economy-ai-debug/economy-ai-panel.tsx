import { Checkbox } from "../../components/checkbox";
import type { EconomyAiSession } from "./session";
import type { EconomyAiFactionView, EconomyAiGoalRow, EconomyAiRow } from "./types";
import { useEconomyAiDebug } from "./use-economy-ai-debug";

import "./economy-ai-panel.css";

interface RowListProps {
  rows: readonly EconomyAiRow[];
  title: string;
}
/** A titled list of label/value lines; a section without lines is left out. */
const RowList = ({ rows, title }: RowListProps) => {
  if (!rows.length) return null;
  return (
    <section className="economy-ai-panel__section">
      <h3>{title}</h3>
      <dl>
        {rows.map((row, index) => (
          <div key={`${row.label}/${index}`}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
};

interface GoalRowProps {
  row: EconomyAiGoalRow;
}
const GoalRow = ({ row }: GoalRowProps) => (
  <tr aria-current={row.committed} title={row.title}>
    <th scope="row">{row.id}</th>
    <td>{row.score}</td>
    <td>{row.deficit}</td>
    <td>{row.weight}</td>
    <td>{row.factor}</td>
    <td>{row.cost}</td>
    <td>{row.threat}</td>
    <td>{row.state}</td>
  </tr>
);

interface GoalsSectionProps {
  goal: string;
  note: string;
  rows: readonly EconomyAiGoalRow[];
}
/** The committed goal and the top goals with the terms of their score (plan §3.4). */
const GoalsSection = ({ goal, note, rows }: GoalsSectionProps) => (
  <section className="economy-ai-panel__section">
    <h3>Goals</h3>
    <p>Committed: <strong>{goal}</strong>. {note}</p>
    {rows.length > 0 && (
      <table>
        <thead>
          <tr>
            <th scope="col">Goal</th>
            <th scope="col" title="deficit × weight × factor − cost − threat">Score</th>
            <th scope="col" title="Buildings still missing">Def.</th>
            <th scope="col" title="The goal's weight in the build program">Wt</th>
            <th scope="col" title="Style × posture factor">Fac.</th>
            <th scope="col" title="Construction cost as a share of the free stock">Cost</th>
            <th scope="col" title="Penalty of an exposed goal per known enemy soldier">Thr.</th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => <GoalRow key={row.id} row={row} />)}
        </tbody>
      </table>
    )}
  </section>
);

interface WaitsSectionProps {
  waits: readonly string[];
}
const WaitsSection = ({ waits }: WaitsSectionProps) => {
  if (!waits.length) return null;
  return (
    <section className="economy-ai-panel__section economy-ai-panel__waits">
      <h3>Waiting because</h3>
      <ul>
        {waits.map(wait => <li key={wait}>{wait}</li>)}
      </ul>
    </section>
  );
};

interface FactionViewProps {
  view: EconomyAiFactionView;
}
const FactionView = ({ view }: FactionViewProps) => (
  <>
    <RowList rows={view.setting} title={view.title} />
    <WaitsSection waits={view.waits} />
    <GoalsSection goal={view.goal} note={view.goalsNote} rows={view.goals} />
    <RowList rows={view.backoffs} title="Backoffs" />
    <RowList rows={view.planner} title="Planner" />
    <RowList rows={view.maintain} title="Maintain" />
    <RowList rows={view.manager} title="Economy manager" />
  </>
);

interface EconomyAiPanelProps {
  session: Pick<EconomyAiSession, "marksShown" | "state">;
}
/** Development tools > Economy > Economy AI: why each computer faction builds, waits or backs off. */
export const EconomyAiPanel = ({ session }: EconomyAiPanelProps) => {
  const { clock, factions, marksShown, selected, switchable, onMarksChange, onSelect } = useEconomyAiDebug(session);
  if (!selected) return <p role="status">No AI faction on this island: the map gives none maintain or develop.</p>;
  return (
    <div className="economy-ai-panel">
      <div className="economy-ai-panel__bar">
        <span role="status">{clock}</span>
        <Checkbox checked={marksShown} label="Plots on map"
          title="Mark refused plots (red) and waiting candidates (blue)" onChange={onMarksChange} />
      </div>
      {switchable && (
        <div aria-label="AI faction" className="economy-ai-panel__factions" role="group">
          {factions.map(({ faction, pressed, title }) => (
            <button aria-pressed={pressed} key={faction} title={title} type="button" onClick={() => onSelect(faction)}>
              {faction}
            </button>
          ))}
        </div>
      )}
      <FactionView view={selected} />
    </div>
  );
};
