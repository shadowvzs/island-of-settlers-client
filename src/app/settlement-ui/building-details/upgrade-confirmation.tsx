import { useLingui } from "@lingui/react";
import { useId, useMemo } from "react";
import { createPortal } from "react-dom";

import { InfoTooltip, InfoTooltipContent } from "../../components/info-tooltip";
import { Popup } from "../../components/popup";
import { SettlementIcon } from "../../components/settlement-icon";
import { useInfoTooltip } from "../../components/use-info-tooltip";
import { WareIcon } from "../../components/ware-icon";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { UpgradeRequestView, UpgradeView } from "./upgrade-helpers";
import { useUpgradeConfirmation } from "./use-upgrade-confirmation";

import "./workshop-upgrade.css";

interface UpgradeRequestProps {
  request: UpgradeRequestView;
}
const UpgradeRequest = ({ request }: UpgradeRequestProps) => (
  <>
    <p className="settlement-ui__upgrade-cost">
      {request.costItems.map(item => (
        <span className="settlement-ui__upgrade-cost-item" key={item.ware}>
          <WareIcon ware={item.ware} />
          {item.text}
        </span>
      ))}
    </p>
    <p>{request.status}</p>
    <p>{request.supply}</p>
    {request.missing && <p>{request.missing}</p>}
    {request.roadBlocked && <p>{request.roadBlocked}</p>}
  </>
);

interface UpgradeButtonProps extends UpgradeRequestProps {
  onUpgrade: (cancel: boolean) => boolean | void;
}
const UpgradeButton = ({ request, onUpgrade }: UpgradeButtonProps) => (
  <button
    className="settlement-ui__button"
    disabled={request.disabled}
    title={request.buttonTitle}
    type="button"
    onClick={() => onUpgrade(request.cancel)}
  >
    {request.button}
  </button>
);

interface UpgradeConfirmationProps {
  /** Subject identity: the confirmation closes when another subject is shown. */
  id: string;
  /** Data attribute naming the subject on the trigger (`<name>`) and the confirmation (`<name>-confirmation`). */
  subject: "bridge-upgrade" | "workshop-upgrade";
  view: UpgradeView;
  visible: boolean;
  onUpgrade: (cancel: boolean) => boolean | void;
}
/**
 * The Upgrade button with its tooltip and separate confirmation (cost, delivery/builder status and
 * the request/cancel action). Shared by buildings and bridges; the subject supplies the prepared view.
 */
export const UpgradeConfirmation = ({ id, subject, view, visible, onUpgrade }: UpgradeConfirmationProps) => {
  const { i18n } = useLingui();
  const { close, dialogRef, opened, open, triggerRef } = useUpgradeConfirmation(id, visible);
  const titleId = useId();
  const disabled = !view.request || view.request.disabled;
  const lines = useMemo(() => {
    const result = [{ marked: true, text: i18n._(M.popup.upgrade) }, ...view.benefitLines];
    if (view.request?.disabled) {
      result.push({ text: view.request.buttonTitle });
      if (view.request.missing) result.push({ text: view.request.missing });
    }
    return result;
  }, [i18n, view]);
  const { anchorRef, tooltipRef, ...tooltip } = useInfoTooltip(lines);
  const confirm = (cancel: boolean) => {
    if (!visible || !opened || !view.request || view.request.disabled) return;
    if (onUpgrade(cancel) !== false) close();
  };
  return (
    <>
      <span className="info-tooltip workshop-upgrade-trigger" ref={anchorRef}>
        <button
          aria-describedby={tooltip.id}
          aria-disabled={disabled}
          aria-expanded={opened}
          aria-haspopup="dialog"
          aria-label={i18n._(M.details.upgrade.upgrade)}
          className="settlement-ui__button workshop-upgrade-trigger__button"
          {...{ [`data-${subject}`]: id }}
          ref={triggerRef}
          type="button"
          onBlur={tooltip.onBlur}
          onClick={() => { if (disabled) tooltip.onClick(); else open(); }}
          onFocus={tooltip.onFocus}
          onKeyDown={tooltip.onKeyDown}
          onMouseEnter={tooltip.onMouseEnter}
          onMouseLeave={tooltip.onMouseLeave}
        >
          <SettlementIcon name="collapse" />
          <span>{i18n._(M.details.upgrade.upgrade)}</span>
        </button>
        <InfoTooltipContent {...tooltip} lines={lines} shown={tooltip.shown && !opened} tooltipRef={tooltipRef} />
      </span>
      {opened && createPortal(
        <div
          className="settlement-ui workshop-upgrade-modal"
          ref={dialogRef}
          onPointerDown={event => {
            event.stopPropagation();
            if (event.target === event.currentTarget) close();
          }}
        >
          <Popup
            actions={<>
              {view.request && <UpgradeButton request={view.request} onUpgrade={confirm} />}
              <button className="settlement-ui__button" type="button" onClick={close}>
                {i18n._(M.details.upgrade.close)}
              </button>
            </>}
            className="workshop-upgrade-modal__panel"
            focusKey={id}
            labelledBy={titleId}
            tone="info"
          >
            <h2 id={titleId}>{view.confirmTitle}</h2>
            <section className="settlement-ui__upgrade" {...{ [`data-${subject}-confirmation`]: id }}>
              <h3>{view.heading}</h3>
              <p data-upgrade-current="">{view.current}</p>
              {view.next && <p data-upgrade-next="">{view.next}</p>}
              {view.note && <p>{view.note}</p>}
              {view.request && <UpgradeRequest request={view.request} />}
              {view.showBenefits && (
                <div className="settlement-ui__upgrade-actions">
                  <InfoTooltip label={i18n._(M.details.upgrade.benefits)} lines={view.benefitLines} />
                </div>
              )}
            </section>
          </Popup>
        </div>, document.body
      )}
    </>
  );
};
