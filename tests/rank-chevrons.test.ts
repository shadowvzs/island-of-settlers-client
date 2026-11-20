import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RankChevrons } from "../src/app/settlement-ui/rank-chevrons";

describe("portrait rank chevrons", () => {
  it.each([1, 2, 3])("stacks %i gold chevrons without a numeral badge or outer frame", level => {
    const html = renderToStaticMarkup(createElement(RankChevrons, { level }));
    expect(html.match(/data-chevron=""/g)).toHaveLength(level);
    expect(html).toContain(`data-rank-level="${level}"`);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("linearGradient");
    expect(html).not.toContain("<rect");
    expect(html).not.toContain("III");
  });
});
