import { useLingui } from "@lingui/react";

import { IconButton } from "../../components/icon-button";
import { WareIcon } from "../../components/ware-icon";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementBuildingSummary, SettlementUiOptions } from "../types";
import { getStorageCollectTool, type StorageCell, type StorageCollectTool } from "./storage-helpers";

interface StorageWareProps {
  cell: StorageCell;
  onWare: (ware: string) => void;
}
const StorageWare = ({ cell, onWare }: StorageWareProps) => {
  const { i18n } = useLingui();
  return (
  <button
    aria-label={cell.label}
    aria-pressed={cell.collecting}
    className="settlement-ui__storage-ware"
    data-collecting={cell.collecting}
    data-count={cell.count}
    data-ware={cell.ware}
    disabled={cell.disabled}
    title={cell.title ?? cell.label}
    type="button"
    onClick={() => onWare(cell.ware)}
  >
    <WareIcon ware={cell.ware} />
    <b>{cell.count}</b>
    {(cell.held !== undefined || cell.incoming !== undefined) && (
      <small className="settlement-ui__storage-pool settlement-ui__storage-pool--badges"
        title={cell.poolTitle ?? i18n._(M.details.storage.poolTitle)}>
        {cell.held !== undefined && <span className="settlement-ui__storage-held">{cell.held}</span>}
        {cell.held !== undefined && cell.incoming !== undefined && <span aria-hidden="true">/</span>}
        {cell.incoming !== undefined && <span className="settlement-ui__storage-incoming">+{cell.incoming}</span>}
      </small>
    )}
    {cell.pool && <small className="settlement-ui__storage-pool"
      title={cell.poolTitle ?? i18n._(M.details.storage.poolTitle)}>{cell.pool}</small>}
  </button>
  );
};

interface StorageWaresProps {
  ariaLabel?: string;
  buildingId: string;
  capacityText: string | null;
  cells: readonly StorageCell[];
  onWare: (ware: string) => void;
}
/** Resources page: every ware of this depot with its receive / send-out marks and the island pool. */
export const StorageWares = ({ ariaLabel, buildingId, capacityText, cells, onWare }: StorageWaresProps) => {
  const { i18n } = useLingui();
  return (
  <section
    aria-label={ariaLabel ?? i18n._(M.details.storage.aria)}
    className="settlement-ui__inventory settlement-ui__storage-wares"
    data-building-inventory={buildingId}
  >
    {capacityText && <p>{capacityText}</p>}
    <div className="settlement-ui__inventory-grid">
      {cells.map(cell => <StorageWare cell={cell} key={cell.ware} onWare={onWare} />)}
    </div>
  </section>
  );
};

interface StorageCollectProps {
  building: SettlementBuildingSummary;
  options: SettlementUiOptions;
  tool: StorageCollectTool;
  onTool: (tool: StorageCollectTool) => void;
}
/** One compact action; persistent selected wares belong to the destination pool. */
export const StorageCollect = ({ building, options, tool, onTool }: StorageCollectProps) => {
  const { i18n } = useLingui();
  const view = getStorageCollectTool(building, options, tool, i18n);
  if (!view) return null;
  const toggle = () => {
    if (tool === "collect") { onTool(null); return; }
    onTool("collect");
  };
  return (
    <IconButton
      data={{ "data-storage-tool": "collect" }}
      disabled={view.disabled}
      icon="import"
      label={view.label}
      pressed={view.pressed}
      title={view.title}
      onClick={toggle}
    />
  );
};
