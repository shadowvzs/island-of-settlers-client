import { useLingui } from "@lingui/react";

import { ProgressBar } from "../../components/progress-bar";
import { WareIcon } from "../../components/ware-icon";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementBuildingSummary } from "../types";
import type { ConstructionDetailsView } from "./construction-helpers";
import { getBuildingLevelLabel } from "./construction-helpers";

interface BuildingLevelProps {
  building: SettlementBuildingSummary;
}
/** Current completed level, separate from an in-progress upgrade target. */
export const BuildingLevel = ({ building }: BuildingLevelProps) => {
  const { i18n } = useLingui();
  const { level, text } = getBuildingLevelLabel(building, i18n);
  return (
    <p aria-label={i18n._(M.details.levelAria)} className="settlement-ui__building-level" data-building-level={level}>
      <strong>{text}</strong>
    </p>
  );
};

type Material = ConstructionDetailsView["materials"][number];

interface MaterialRowProps {
  material: Material;
}
const MaterialRow = ({ material }: MaterialRowProps) => (
  <tr>
    <th scope="row">
      <WareIcon ware={material.ware} />
      {material.name}
    </th>
    <td>{material.required}</td>
    <td>{material.delivered}</td>
    <td>{material.incoming}</td>
  </tr>
);

interface MaterialsTableProps {
  materials: readonly Material[];
}
const MaterialsTable = ({ materials }: MaterialsTableProps) => {
  const { i18n } = useLingui();
  return (
    <table className="settlement-ui__construction-materials">
      <caption>{i18n._(M.details.construction.materials)}</caption>
      <tbody>
        <tr>
          <th scope="col">{i18n._(M.details.construction.material)}</th>
          <th scope="col">{i18n._(M.details.construction.required)}</th>
          <th scope="col">{i18n._(M.details.construction.delivered)}</th>
          <th scope="col">{i18n._(M.details.construction.inTransit)}</th>
        </tr>
        {materials.map(material => <MaterialRow key={material.ware} material={material} />)}
      </tbody>
    </table>
  );
};

interface ConstructionSectionProps {
  details: ConstructionDetailsView;
}
export const ConstructionSection = ({ details }: ConstructionSectionProps) => {
  const { i18n } = useLingui();
  return (
    <section aria-label={i18n._(M.details.construction.aria)} className="settlement-ui__construction">
      <p>{details.progressText}</p>
      <ProgressBar label={i18n._(M.details.construction.progressLabel)} max={1} value={details.progress} />
      <p>{details.status}</p>
      {details.foundation && <p>{details.foundation}</p>}
      {details.blocker && <p>{details.blocker}</p>}
      {details.showMaterials && <MaterialsTable materials={details.materials} />}
    </section>
  );
};
