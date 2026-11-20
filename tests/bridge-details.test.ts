import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { createExternalStore } from "../src/app/components/ui-store";
import { BridgeDetails } from "../src/app/settlement-ui/bridge-details/bridge-details";
import {
  getBridgeDetailsTitle, getBridgeDetailsView, getBridgeUpgradeView, selectBridgeDetails
} from "../src/app/settlement-ui/bridge-details/helpers";
import type { SettlementWindowVisibility } from "../src/app/settlement-ui/react-window";
import type { SettlementBridgeSummary, SettlementUiOptions } from "../src/app/settlement-ui/types";
import { createSettlementUiStore } from "../src/app/settlement-ui/ui-store";
import { createTestI18n, renderWithI18n } from "./helpers/render-with-i18n";

const bridge = (fields: Partial<SettlementBridgeSummary> = {}): SettlementBridgeSummary => ({
  completed: true, id: "3", kind: "wood", level: 1, tiles: 6,
  upgrade: { available: true, cost: { hardwoodPlanks: 2 }, supply: { hardwoodPlanks: 5 } }, ...fields
});
const options = { onBridgeUpgrade: () => true, onRemoveBridge: () => true } as unknown as SettlementUiOptions;
const visible = () => createExternalStore<SettlementWindowVisibility>({ opened: 1, visible: true });
const render = (subject: SettlementBridgeSummary, locale: "en" | "hu" = "en") => {
  const store = createSettlementUiStore();
  store.update({ bridges: [subject], focusedBridge: subject.id });
  return renderWithI18n(createElement(BridgeDetails, { options, store, visibility: visible() }), locale);
};

describe("bridge panel", () => {
  it("selects only the focused, existing bridge", () => {
    expect(selectBridgeDetails({ bridges: [bridge()], focusedBridge: "3" }).bridge?.id).toBe("3");
    expect(selectBridgeDetails({ bridges: [bridge()], focusedBridge: "9" }).bridge).toBeUndefined();
    expect(selectBridgeDetails({ bridges: [bridge()] }).bridge).toBeUndefined();
    expect(getBridgeDetailsTitle(bridge())).toBe("Wooden bridge");
    expect(getBridgeDetailsTitle(bridge({ kind: "stone" }))).toBe("Stone bridge");
  });

  it("shows the level, span, Remove and Upgrade for a completed bridge", () => {
    const markup = render(bridge());
    expect(markup).toContain('data-bridge-level="1"');
    expect(markup).toContain("Level 1");
    expect(markup).toContain("6 tiles across the river");
    expect(markup).toContain('data-bridge-remove="3"');
    expect(markup).toContain('data-bridge-upgrade="3"');
    expect(markup).not.toContain("settlement-ui__construction");
  });

  it("shows a site's construction materials and no Upgrade until it is finished", () => {
    const markup = render(bridge({ completed: false, site: { delivered: { logs: 4, planks: 1 },
      incoming: { logs: 2 }, progress: 0.4, required: { logs: 12, planks: 6 }, stage: "deck" } }));
    expect(markup).toContain("Level 1 · Under construction");
    expect(markup).toContain("Construction: 40%");
    expect(markup).toContain("Building the deck");
    expect(markup).toContain('class="settlement-ui__construction-materials"');
    expect(markup).not.toContain("data-bridge-upgrade");
    expect(markup).toContain('data-bridge-remove="3"');
  });

  it("shows a pending removal and the dismantling share, with Remove disabled and no Upgrade", () => {
    const closing = render(bridge({ removal: { phase: "closing", progress: 1 } }));
    expect(closing).toContain("Removal ordered: waiting for the deck to clear.");
    expect(closing).not.toContain("data-bridge-upgrade");
    expect(closing).toMatch(/data-bridge-remove="3"[^>]*disabled|disabled[^>]*data-bridge-remove="3"/);
    const dismantling = render(bridge({ completed: false, removal: { phase: "dismantling", progress: 0.25 } }));
    expect(dismantling).toContain("Taking the bridge down: 75%.");
    expect(render(bridge({ removal: { phase: "dismantling", progress: 0.25 } }), "hu"))
      .toContain("A híd bontása: 75%.");
  });

  it("explains each level's design, the next cost and refusals", () => {
    const i18n = createTestI18n();
    const view = getBridgeUpgradeView(bridge({ level: 2 }), i18n)!;
    expect(view.current).toBe("Now (level 2): hardwood, capped posts and braced railing bays.");
    expect(view.next).toBe("Level 3: cedar, fascia boards and post brackets.");
    expect(view.note).toContain("changes only the look");
    expect(view.benefitLines.map(line => line.text)).toHaveLength(6);
    expect(view.request!.costItems[0]!.text).toBe("Hardwood planks: 2");
    expect(view.request!.disabled).toBe(false);
    const short = getBridgeUpgradeView(bridge({ upgrade: { available: false, cost: { marble: 2 },
      reason: "missing-material", supply: { marble: 1 } }, kind: "stone" }), i18n)!;
    expect(short.request!.disabled).toBe(true);
    expect(short.request!.missing).toBe("Missing storage stock: 1 marble.");
    const unconnected = getBridgeUpgradeView(bridge({ upgrade: { available: false, cost: { hardwoodPlanks: 2 },
      reason: "no-storage", supply: {} } }), i18n)!;
    expect(unconnected.request!.roadBlocked).toContain("Connect a shore");
    const top = getBridgeUpgradeView(bridge({ level: 5, upgrade: { available: false, cost: {}, reason: "max-level",
      supply: {} } }), i18n)!;
    expect(top.request).toBeNull();
    expect(top.heading).toBe("Bridge level 5 (maximum)");
  });

  it("tracks a running upgrade and offers its cancellation", () => {
    const i18n = createTestI18n();
    const running = bridge({ site: { delivered: { hardwoodPlanks: 1 }, incoming: { hardwoodPlanks: 1 },
      progress: 0.25, required: { hardwoodPlanks: 2 }, stage: "foundations", upgradeTo: 2 },
    upgrade: { available: false, cost: { hardwoodPlanks: 2 }, reason: "busy", supply: { hardwoodPlanks: 3 } } });
    const view = getBridgeDetailsView(running, i18n);
    expect(view.level.text).toBe("Level 1 · Upgrading to level 2");
    expect(view.construction).toBeNull();
    expect(view.upgrade!.request!.cancel).toBe(true);
    expect(view.upgrade!.request!.disabled).toBe(false);
    expect(view.upgrade!.request!.costItems[0]!.text).toBe("Hardwood planks: 1/2 delivered (1 on the way)");
    expect(view.upgrade!.request!.status).toBe("Builder refitting the bridge: 25%.");
    expect(view.removal.consequence).toContain("nearer bank");
  });

  it("is translated to Hungarian", () => {
    const markup = render(bridge({ kind: "stone" }), "hu");
    expect(markup).toContain("1 szint");
    expect(markup).toContain("Eltávolítás");
    expect(getBridgeDetailsTitle(bridge({ kind: "stone" }), createTestI18n("hu"))).toBe("Kőhíd");
  });
});
