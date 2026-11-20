import { useLingui } from "@lingui/react";

import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementResidenceSummary } from "../types";
import { getResidenceView } from "./residence-helpers";

interface ResidenceSectionProps {
  residence: SettlementResidenceSummary;
}
/** A residence's population effect: limit bonus and the settler period it adds (no ware sections). */
export const ResidenceSection = ({ residence }: ResidenceSectionProps) => {
  const { i18n } = useLingui();
  const { note, stats } = getResidenceView(residence, i18n);
  return (
    <section aria-label={i18n._(M.details.residence.aria)} className="settlement-ui__residence">
      <dl>
        {stats.map(stat => (
          <div key={stat.label}>
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
          </div>
        ))}
      </dl>
      <p className="settlement-ui__section-description">{note}</p>
    </section>
  );
};
