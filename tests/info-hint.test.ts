import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InlineInfo } from "../src/app/components/info-hint";

describe("InlineInfo", () => {
  it("renders the shared blue info button with its description in the tooltip", () => {
    const text = "A long description that belongs to the control beside this button.";
    const markup = renderToStaticMarkup(createElement(InlineInfo, { info: { label: "Details", text } }));
    expect(markup).toContain('class="info-tooltip info-tooltip--blue"');
    expect(markup).toContain('aria-label="Details"');
    expect(markup).toContain(`<p class="info-tooltip__line">${text}</p>`);
  });
});
