import { useLingui } from "@lingui/react";

import { translateMessage } from "../../../shared/i18n/translate";
import { CountStepper } from "../../components/count-stepper";
import { WareIcon } from "../../components/ware-icon";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementBuildingSummary } from "../types";
import { type ArmoryOrderRow, getArmoryOrders } from "./production-mode-helpers";

type OrderChange = (ware: string, amount: number | null) => void;

interface OrderRowProps {
  row: ArmoryOrderRow;
  onChange: OrderChange;
}
const OrderRow = ({ row, onChange }: OrderRowProps) => {
  const { i18n } = useLingui();
  return (
  <div className="settlement-ui__armory-order" data-production-ware={row.ware} title={row.name}>
    <span className="settlement-ui__order-ware">
      <WareIcon ware={row.ware} />
    </span>
    <CountStepper
      count={row.count}
      countLabel={`${row.name} remaining`}
      decreaseDisabled={row.decreaseDisabled}
      decreaseLabel={translateMessage(i18n, M.details.production.fewer, { ware: row.ware })}
      increaseDisabled={row.increaseDisabled}
      increaseLabel={translateMessage(i18n, M.details.production.more, { ware: row.ware })}
      onDecrease={() => onChange(row.ware, row.decrease)}
      onIncrease={() => onChange(row.ware, row.increase)}
    />
    <button
      aria-label={translateMessage(i18n, M.details.production.unlimited, { ware: row.ware })}
      aria-pressed={row.unlimited}
      title={translateMessage(i18n, M.details.production.unlimited, { ware: row.ware })}
      type="button"
      onClick={() => onChange(row.ware, row.unlimitedNext)}
    >
      ∞
    </button>
  </div>
  );
};

interface ArmoryOrdersProps {
  building: SettlementBuildingSummary;
  onChange: OrderChange;
}
/** Armory production orders: a remaining count per output, or unlimited. */
export const ArmoryOrders = ({ building, onChange }: ArmoryOrdersProps) => {
  const { i18n } = useLingui();
  return (
    <div className="settlement-ui__armory-orders">
      <b>{i18n._(M.details.production.orders)}</b>
      {getArmoryOrders(building).map(row => <OrderRow key={row.ware} row={row} onChange={onChange} />)}
    </div>
  );
};
