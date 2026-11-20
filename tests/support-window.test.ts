import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { SUPPORT_LINKS } from "../src/app/settlement-ui/support/links";
import { SupportPanel } from "../src/app/settlement-ui/support/support-panel";
import { renderWithI18n } from "./helpers/render-with-i18n";

describe("support window", () => {
  it("opens both donation pages in a new tab", () => {
    const markup = renderWithI18n(createElement(SupportPanel));
    expect(markup).toContain(`href="${SUPPORT_LINKS.revolut}"`);
    expect(markup).toContain(`href="${SUPPORT_LINKS.paypal}"`);
    expect(markup.match(/rel="noopener noreferrer"/g)).toHaveLength(2);
    expect(markup.match(/target="_blank"/g)).toHaveLength(2);
  });

  it("shows the free-project note, the AI cost reason and the Revolut QR code", () => {
    const markup = renderWithI18n(createElement(SupportPanel));
    expect(markup).toContain("free project");
    expect(markup).toContain("AI tools and services");
    expect(markup).toContain('alt="Revolut donation QR code"');
    expect(markup).toContain("revolut-qr");
    expect(markup).toContain("Thank you for playing");
  });
});
