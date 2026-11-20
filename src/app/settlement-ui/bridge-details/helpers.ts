import type { I18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";

import type { Goods } from "../../../../../island-of-settlers-shared/src/goods";
import { translateMessage } from "../../../shared/i18n/translate";
import { MAX_BRIDGE_LEVEL } from "../../../shared/settlement/road-types";
import { wareDisplayName } from "../../../shared/settlement/ware-names";
import type { TooltipLine } from "../../components/info-tooltip-helpers";
import type { ConstructionDetailsView } from "../building-details/construction-helpers";
import type { UpgradeRequestView, UpgradeView } from "../building-details/upgrade-helpers";
import { getSettlementInventoryEntries } from "../inventory";
import { getRoadPreviewSource } from "../main-panel/road-previews";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementBridgeSummary, SettlementUiSnapshot } from "../types";

type Bridge = SettlementBridgeSummary;
type ReadonlyGoods = Readonly<Goods>;

const DESIGNS: Readonly<Record<Bridge["kind"], readonly MessageDescriptor[]>> = {
  stone: [M.bridge.designStone1, M.bridge.designStone2, M.bridge.designStone3, M.bridge.designStone4,
    M.bridge.designStone5],
  wood: [M.bridge.designWood1, M.bridge.designWood2, M.bridge.designWood3, M.bridge.designWood4,
    M.bridge.designWood5]
};
const STAGES = { deck: M.bridge.stageDeck, foundations: M.bridge.stageFoundations, railings: M.bridge.stageRailings };

/** The focused bridge, or undefined when none is focused or it no longer exists. */
export const selectBridgeDetails = (snapshot: Readonly<SettlementUiSnapshot>) => ({
  bridge: snapshot.focusedBridge ? snapshot.bridges?.find(bridge => bridge.id === snapshot.focusedBridge) : undefined
});

/** Window title: the bridge's kind ("Wooden bridge"), or the generic title before one is focused. */
export const getBridgeDetailsTitle = (bridge: Pick<Bridge, "kind"> | undefined, i18n?: I18n) => {
  if (!bridge) return translateMessage(i18n, M.bridge.title);
  return translateMessage(i18n, bridge.kind === "wood" ? M.bridge.nameWood : M.bridge.nameStone);
};

const design = (bridge: Bridge, level: number, i18n?: I18n) => translateMessage(i18n, DESIGNS[bridge.kind][level - 1]!);
const upgradeTarget = (bridge: Bridge) => bridge.site?.upgradeTo;

/** The removal line: pending while the deck clears, then the share already taken down. */
export const getBridgeRemovalStatus = (bridge: Bridge, i18n?: I18n) => {
  const removal = bridge.removal;
  if (!removal) return null;
  if (removal.phase === "closing") return translateMessage(i18n, M.bridge.removalPending);
  return translateMessage(i18n, M.bridge.dismantling, { percent: Math.round((1 - removal.progress) * 100) });
};

/** "Level N", with its construction or upgrade state. */
export const getBridgeLevelText = (bridge: Bridge, i18n?: I18n) => {
  const level = bridge.level;
  if (bridge.removal) return translateMessage(i18n, M.details.level, { level });
  if (!bridge.completed) return translateMessage(i18n, M.details.levelUnderConstruction, { level });
  const next = upgradeTarget(bridge);
  if (next !== undefined) return translateMessage(i18n, M.details.levelUpgrading, { level, next });
  return translateMessage(i18n, M.details.level, { level });
};

const amountText = (goods: ReadonlyGoods) =>
  Object.entries(goods).map(([ware, count]) => `${count} ${wareDisplayName(ware).toLowerCase()}`).join(" and ");

/** A new bridge's builder site in the shared construction section's shape. */
export const getBridgeConstructionView = (bridge: Bridge, i18n?: I18n): ConstructionDetailsView | null => {
  const site = bridge.site;
  if (!site || upgradeTarget(bridge) !== undefined) return null;
  const materials = getSettlementInventoryEntries(site.required).map(({ count, name, ware }) => ({
    delivered: String(site.delivered[ware] ?? 0), incoming: String(site.incoming[ware] ?? 0), name,
    required: String(count), ware
  }));
  return {
    blocker: null,
    foundation: null,
    materials,
    progress: site.progress,
    progressText: translateMessage(i18n, M.details.construction.progress, { percent: Math.round(site.progress * 100) }),
    showMaterials: materials.length > 0,
    status: translateMessage(i18n, STAGES[site.stage])
  };
};

const benefitLine = (bridge: Bridge, level: number, i18n?: I18n): TooltipLine => {
  const line = translateMessage(i18n, M.details.upgrade.level, { benefits: design(bridge, level, i18n), level });
  if (level <= bridge.level) return { text: translateMessage(i18n, M.details.upgrade.reached, { line }) };
  if (level === bridge.level + 1) return { marked: true, text: translateMessage(i18n, M.details.upgrade.next, { line }) };
  return { text: line };
};

const refusalText = (bridge: Bridge, i18n?: I18n) => {
  if (bridge.upgrade.reason === "busy") return translateMessage(i18n, M.bridge.busy);
  if (bridge.upgrade.reason === "no-storage") return translateMessage(i18n, M.bridge.noStorage);
  if (bridge.upgrade.reason === "map-cap") return translateMessage(i18n, M.bridge.mapCap);
  return null;
};

const missingText = (bridge: Bridge, cost: ReadonlyGoods, i18n?: I18n) => {
  if (bridge.upgrade.reason !== "missing-material") return null;
  const missing = Object.fromEntries(Object.entries(cost).map(([ware, count]) =>
    [ware, Math.max(0, count - (bridge.upgrade.supply[ware] ?? 0))]).filter(([, count]) => (count as number) > 0));
  return translateMessage(i18n, M.details.upgrade.missing, { items: amountText(missing) });
};

const upgradeStatus = (bridge: Bridge, cost: ReadonlyGoods, i18n?: I18n) => {
  const site = bridge.site;
  if (!site || upgradeTarget(bridge) === undefined)
    return translateMessage(i18n, M.bridge.statusIdle, { cost: amountText(cost) });
  if (site.progress > 0)
    return translateMessage(i18n, M.bridge.statusProgress, { percent: Math.round(site.progress * 100) });
  return translateMessage(i18n, M.details.upgrade.statusWaiting);
};

const costItems = (bridge: Bridge, cost: ReadonlyGoods, tracking: boolean, i18n?: I18n) =>
  Object.entries(cost).map(([ware, required]) => {
    const name = wareDisplayName(ware);
    if (!tracking) return { text: translateMessage(i18n, M.details.upgrade.cost, { name, required }), ware };
    const delivered = bridge.site?.delivered[ware] ?? 0, incoming = bridge.site?.incoming[ware] ?? 0;
    return { text: translateMessage(i18n, M.details.upgrade.costTracking, { delivered, incoming, name, required }),
      ware };
  });

const upgradeRequest = (bridge: Bridge, i18n?: I18n): UpgradeRequestView => {
  const pending = upgradeTarget(bridge) !== undefined;
  const cost = pending ? bridge.site!.required : bridge.upgrade.cost;
  const refusal = refusalText(bridge, i18n);
  const supply = Object.keys(cost).map(ware => `${bridge.upgrade.supply[ware] ?? 0} ` +
    wareDisplayName(ware).toLowerCase()).join(", ");
  return {
    button: translateMessage(i18n, pending ? M.details.upgrade.cancelUpgrade : M.details.upgrade.upgrade),
    buttonTitle: pending ? translateMessage(i18n, M.details.upgrade.cancelTitle)
      : refusal ?? translateMessage(i18n, M.bridge.requires, { cost: amountText(cost) }),
    cancel: pending,
    costItems: costItems(bridge, cost, pending, i18n),
    disabled: !pending && !bridge.upgrade.available,
    missing: pending ? null : missingText(bridge, cost, i18n),
    roadBlocked: !pending && bridge.upgrade.reason === "no-storage" ? refusal : null,
    status: upgradeStatus(bridge, cost, i18n),
    supply: translateMessage(i18n, M.details.upgrade.available, { supply })
  };
};

/** The shared upgrade confirmation's view for a completed bridge; null while it is still being built. */
export const getBridgeUpgradeView = (bridge: Bridge, i18n?: I18n): UpgradeView | null => {
  if (!bridge.completed || bridge.removal) return null;
  const level = bridge.level, atMaximum = level >= MAX_BRIDGE_LEVEL;
  const levels = Array.from({ length: MAX_BRIDGE_LEVEL }, (_, index) => index + 1);
  return {
    benefitLines: [{ text: translateMessage(i18n, M.bridge.upgradeTitle) },
      ...levels.map(entry => benefitLine(bridge, entry, i18n))],
    confirmTitle: translateMessage(i18n, M.bridge.confirmTitle),
    current: translateMessage(i18n, M.bridge.current, { design: design(bridge, level, i18n), level }),
    heading: atMaximum ? translateMessage(i18n, M.bridge.headingMax, { level })
      : translateMessage(i18n, M.details.upgrade.headingNext, { level: level + 1 }),
    next: atMaximum ? null
      : translateMessage(i18n, M.bridge.nextLevel, { design: design(bridge, level + 1, i18n), level: level + 1 }),
    note: translateMessage(i18n, M.bridge.note),
    request: atMaximum ? null : upgradeRequest(bridge, i18n),
    showBenefits: true
  };
};

/** Remove confirmation copy: what happens to people, carriers and materials. */
export const getBridgeRemovalView = (bridge: Bridge, i18n?: I18n) => {
  const name = getBridgeDetailsTitle(bridge, i18n);
  return {
    caption: translateMessage(i18n, M.bridge.removeCaption),
    confirm: translateMessage(i18n, M.common.remove),
    /** Already ordered: the bridge is closing or coming down. */
    disabled: Boolean(bridge.removal),
    confirmLabel: translateMessage(i18n, M.bridge.removeConfirm, { name }),
    consequence: translateMessage(i18n, bridge.completed ? M.bridge.removeCompleted : M.bridge.removeSite),
    keep: translateMessage(i18n, M.common.keep),
    keepLabel: translateMessage(i18n, M.bridge.keep, { name }),
    label: translateMessage(i18n, M.bridge.removeLabel),
    question: translateMessage(i18n, M.bridge.removeQuestion)
  };
};

export type BridgeRemovalView = ReturnType<typeof getBridgeRemovalView>;

/** Everything the bridge panel shows for one bridge. */
export const getBridgeDetailsView = (bridge: Bridge, i18n?: I18n) => ({
  construction: getBridgeConstructionView(bridge, i18n),
  /** The Road-tab render of this bridge kind. */
  image: getRoadPreviewSource(bridge.kind === "wood" ? "bridge-wood" : "bridge-stone") ?? "",
  level: { text: getBridgeLevelText(bridge, i18n), value: String(bridge.level) },
  levelAria: translateMessage(i18n, M.bridge.levelAria),
  removal: getBridgeRemovalView(bridge, i18n),
  removalStatus: getBridgeRemovalStatus(bridge, i18n),
  span: translateMessage(i18n, M.bridge.span, { tiles: bridge.tiles }),
  upgrade: getBridgeUpgradeView(bridge, i18n)
});

export type BridgeDetailsView = ReturnType<typeof getBridgeDetailsView>;
