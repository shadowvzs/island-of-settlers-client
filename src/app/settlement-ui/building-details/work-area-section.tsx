import { SettlementIcon } from "../../components/settlement-icon";
import type { WorkAreaView } from "./work-area-helpers";

interface CountRowProps {
  label: string;
  value: string;
}
const CountRow = ({ label, value }: CountRowProps) => (
  <div>
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);

interface WorkAreaSectionProps {
  area: WorkAreaView;
}
/** Farm and stonemason: their work range and live counts (read-only). */
export const WorkAreaSection = ({ area }: WorkAreaSectionProps) => (
  <section aria-label={area.label} className="settlement-ui__farm-area" {...area.data}>
    <h3>
      <SettlementIcon name={area.icon} />
      {area.heading}
    </h3>
    <p className="settlement-ui__farm-area-location">{area.location}</p>
    <p className="settlement-ui__farm-area-description">{area.description}</p>
    <dl className="settlement-ui__farm-area-counts">
      {area.counts.map(count => <CountRow key={count.label} label={count.label} value={count.value} />)}
    </dl>
  </section>
);
