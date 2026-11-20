import { IconButton } from "../../components/icon-button";
import { SettlementIcon } from "../../components/settlement-icon";
import type { CampaignCargoChip, CampaignDepartModel } from "./helpers";

interface CargoChipProps {
  chip: CampaignCargoChip;
}
/** One cargo line: the ware or soldier picture (settlers: the people icon) and "available/required". */
const CargoChip = ({ chip }: CargoChipProps) => (
  <li className={chip.className} data-cargo={chip.key} title={chip.title}>
    {chip.image && <img alt="" aria-hidden="true" draggable={false} src={chip.image} />}
    {!chip.image && <SettlementIcon name="people" />}
    <span aria-label={chip.title}>{chip.amount}</span>
  </li>
);

interface CampaignDepartureProps {
  cargoLabel: string;
  departLabel: string;
  model: CampaignDepartModel;
  onDepart: () => void;
}
/** What leaves home storage for the chosen map, the ships it needs and the Set sail button. */
export const CampaignDeparture = ({ cargoLabel, departLabel, model, onDepart }: CampaignDepartureProps) => (
  <section aria-label={cargoLabel} className="campaign-window__departure">
    <ul className="campaign-window__chips">
      {model.chips.map(chip => <CargoChip chip={chip} key={chip.key} />)}
      <li className={model.shipsClassName} data-cargo="ships" title={model.ships}>
        <SettlementIcon name="ship" />
        <span aria-label={model.ships}>{model.shipsAmount}</span>
      </li>
    </ul>
    <p className="campaign-window__hint">{model.hint}</p>
    <IconButton
      className="settlement-ui__button--primary"
      data={{ "data-campaign-depart": "" }}
      disabled={model.disabled}
      icon="campaign"
      label={departLabel}
      onClick={onDepart}
    />
  </section>
);
