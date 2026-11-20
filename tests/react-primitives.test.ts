import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { IconButton } from "../src/app/components/icon-button";
import { SettlementIcon } from "../src/app/components/settlement-icon";
import { createExternalStore } from "../src/app/components/ui-store";
import { resolveSettlementIcon } from "../src/app/settlement-ui/icons";

describe("shared React UI primitives", () => {
  it("resolves picture, rendered and paired icons like the DOM helpers", () => {
    expect(resolveSettlementIcon("save").kind).toBe("picture");
    expect(resolveSettlementIcon("apply").kind).toBe("rendered");
    expect(resolveSettlementIcon("sailBack").kind).toBe("sailBack");
    expect(resolveSettlementIcon("no-such-icon")).toEqual(resolveSettlementIcon("warehouse"));
  });

  it("renders the rendered icon as the same 24x24 svg the DOM helper builds", () => {
    const markup = renderToStaticMarkup(createElement(SettlementIcon, { name: "apply" }));
    expect(markup).toMatch(/^<svg aria-hidden="true" class="settlement-art-icon" data-icon="apply"/);
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain(`href="${(resolveSettlementIcon("apply") as { source: string }).source}"`);
  });

  it("adds an extra icon class (corner buttons) to rendered and picture icons", () => {
    expect(renderToStaticMarkup(createElement(SettlementIcon, { className: "settings__icon-image", name: "apply" })))
      .toMatch(/^<svg aria-hidden="true" class="settlement-art-icon settings__icon-image"/);
    expect(renderToStaticMarkup(createElement(SettlementIcon, { className: "extra", name: "save" })))
      .toContain('<img alt="" aria-hidden="true" class="settlement-art-icon extra"');
  });

  it("renders an accessible icon button with its label as tooltip and an optional caption", () => {
    const markup = renderToStaticMarkup(createElement(IconButton, {
      caption: "Apply", className: "extra", disabled: true, icon: "apply", label: "Apply language",
      onClick: () => undefined
    }));
    expect(markup).toContain('aria-label="Apply language"');
    expect(markup).toContain('class="settlement-ui__button extra"');
    expect(markup).toContain('title="Apply language"');
    expect(markup).toContain('type="button"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("<span>Apply</span>");
    const plain = renderToStaticMarkup(createElement(IconButton, { icon: "apply", label: "Apply", onClick: () => undefined }));
    expect(plain).not.toContain("<span>");
  });

  it("notifies subscribers only when the snapshot changes and stops after unsubscribe", () => {
    const store = createExternalStore({ count: 1 });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const same = store.getSnapshot();
    store.set(same);
    expect(listener).not.toHaveBeenCalled();
    store.set({ count: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual({ count: 2 });
    unsubscribe();
    store.set({ count: 3 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
