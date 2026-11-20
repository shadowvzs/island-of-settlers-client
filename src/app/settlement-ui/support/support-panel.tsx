import { useLingui } from "@lingui/react";

import qrUrl from "../../../../assets/support/revolut-qr.png?url";
import { SUPPORT_LINKS } from "./links";
import { SUPPORT_MESSAGES as M } from "./messages";

import "./support.css";

interface SupportLinkProps {
  className: string;
  href: string;
  label: string;
}

/** A donation destination; opening a new tab keeps the game window untouched. */
const SupportLink = ({ className, href, label }: SupportLinkProps) => (
  <a className={className} href={href} rel="noopener noreferrer" target="_blank">{label}</a>
);

/** The support window body: the free-project note, the two donation links and the Revolut QR code. */
export const SupportPanel = () => {
  const { i18n } = useLingui();
  return (
    <section className="support-panel__body">
      <p className="support-panel__lead">{i18n._(M.lead)}</p>
      <p>{i18n._(M.cost)}</p>
      <p>{i18n._(M.call)}</p>
      <div className="support-panel__actions">
        <SupportLink className="settlement-ui__button support-panel__link"
          href={SUPPORT_LINKS.revolut} label={i18n._(M.revolut)} />
        <SupportLink className="settlement-ui__button support-panel__link"
          href={SUPPORT_LINKS.paypal} label={i18n._(M.paypal)} />
      </div>
      <figure className="support-panel__qr">
        <img alt={i18n._(M.qrAlt)} draggable={false} src={qrUrl} />
        <figcaption>{i18n._(M.qr)}</figcaption>
      </figure>
      <p className="support-panel__thanks">{i18n._(M.thanks)}</p>
    </section>
  );
};
