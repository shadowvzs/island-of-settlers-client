import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import { getInventoryCells, getInventoryEmptyText } from "../settlement-ui/inventory";
import { WareIcon } from "./ware-icon";

interface InventoryCell {
  count: string;
  label: string;
  name: string;
  ware: string;
}

interface InventoryViewProps {
  cells: readonly InventoryCell[];
  emptyText?: string;
  heading: string;
}
const InventoryView = ({ cells, emptyText, heading }: InventoryViewProps) => (
  <section aria-label={heading} className="settlement-ui__inventory">
    <h3>{heading}</h3>
    <div className="settlement-ui__inventory-grid">
      {cells.map(({ count, label, name, ware }) => (
        <div aria-label={label} data-count={count} data-ware={ware} key={ware}>
          <WareIcon ware={ware} />
          <small>{name}</small>
          <b>{count}</b>
        </div>
      ))}
    </div>
    {emptyText && <p className="settlement-ui__section-description">{emptyText}</p>}
  </section>
);

const getInventoryView = (inventory?: Readonly<Record<string, number>>, i18n?: Parameters<typeof getInventoryEmptyText>[1]) => {
  const cells = getInventoryCells(inventory);
  if (cells.length) return { cells };
  return { cells, emptyText: getInventoryEmptyText(inventory, i18n) };
};

interface InventoryProps {
  heading: string;
  /** A building's authoritative stock map; absent when the stock is not reported. */
  inventory?: Readonly<Record<string, number>>;
}
/** A building's stock: ordered cells with `data-ware` / `data-count`. */
export const Inventory = ({ heading, inventory }: InventoryProps) => {
  const { i18n } = useLingui();
  return <InventoryView heading={heading}
    {...useMemo(() => getInventoryView(inventory, i18n), [i18n, inventory])} />;
};
