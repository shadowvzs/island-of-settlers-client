import { useLingui } from "@lingui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { translateMessage } from "../../../shared/i18n/translate";
import {
  MARKET_MAX_OPEN_OFFERS, type MarketControls, type MarketResult, type MarketSnapshot
} from "../../../shared/trade/market";
import type { StockGoods } from "../../../shared/trade/stock-move";
import { isDeepEqual } from "../../components/ui-store";
import { errorMessage } from "../../helpers";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiSnapshot } from "../types";
import type { SettlementUiStore } from "../ui-store";
import { useWindowSelector } from "../use-window-selector";
import {
  clampRequestedAmount, defaultOfferForm, getBuyRows, getHomeRows, getMarketExpiryDelay, getOfferDraft,
  getOfferFormView, getOfferProblem, getOfferRows, getWalletRows, type OfferFormValues, totalRows, walletGoods
} from "./helpers";

const selectMarketHome = ({ homeIsland, resources }: SettlementUiSnapshot) => ({
  homeIsland: homeIsland === true,
  resources: resources ?? {}
});
const mergeResult = (current: MarketSnapshot | null, result: MarketResult): MarketSnapshot | null => {
  if (result.snapshot) return result.snapshot;
  if (!current) return current;
  return { ...current, pendingBuy: result.pendingBuy, pendingClaim: result.pendingClaim,
    pendingOffer: result.pendingOffer };
};

/**
 * The Player Market window's state: one server read on each open, the offer form, and the combined
 * offer/cancel/claim actions. A failed or partial action keeps the last snapshot and the service's
 * pending operation, so the same idempotency keys are used by the retry buttons.
 */
export const useMarket = (
  store: SettlementUiStore, visibility: SettlementWindowVisibilityStore, market: MarketControls | undefined
) => {
  const { i18n } = useLingui();
  const { selection, visible } = useWindowSelector(
    store, visibility, selectMarketHome, isDeepEqual, i18n.locale);
  const home = selection.resources;
  const homeOnly = selection.homeIsland;
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [form, setForm] = useState<OfferFormValues>(() => defaultOfferForm({}));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const busyRef = useRef(false);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearExpiryTimer = useCallback(() => {
    if (expiryTimerRef.current === null) return;
    clearTimeout(expiryTimerRef.current);
    expiryTimerRef.current = null;
  }, []);

  const load = useCallback(async (message = "") => {
    if (!market) return;
    clearExpiryTimer();
    setLoading(true);
    setError("");
    try {
      const next = await market.load();
      setSnapshot(next);
      if (message) setStatus(message);
    } catch (cause) {
      setError(errorMessage(cause, i18n._(M.market.errorConnection)));
    } finally {
      setLoading(false);
    }
  }, [clearExpiryTimer, i18n, market]);

  useEffect(() => {
    if (!visible || !market || !homeOnly) return undefined;
    const timer = setTimeout(() => { setStatus(""); void load(); }, 0);
    return () => clearTimeout(timer);
  }, [homeOnly, load, market, visible]);

  useEffect(() => {
    if (!visible || !market || !homeOnly) return undefined;
    const schedule = () => {
      clearExpiryTimer();
      const offers = snapshot ? [...snapshot.mine, ...snapshot.others] : [];
      const delay = getMarketExpiryDelay(offers, Date.now(),
        typeof document !== "undefined" && document.hidden);
      if (delay === null) return;
      expiryTimerRef.current = setTimeout(() => {
        expiryTimerRef.current = null;
        void load();
      }, delay);
    };
    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.hidden) clearExpiryTimer();
      else schedule();
    };
    schedule();
    if (typeof document === "undefined") return clearExpiryTimer;
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearExpiryTimer();
    };
  }, [clearExpiryTimer, homeOnly, load, market, snapshot, visible]);

  const run = useCallback(async (action: () => Promise<MarketResult>, fallback: string,
    onSuccess?: () => void) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setStatus("");
    try {
      const result = await action();
      setStatus(result.message);
      setSnapshot(current => mergeResult(current, result));
      if (result.ok) onSuccess?.();
    } catch (cause) {
      setStatus(errorMessage(cause, fallback));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const homeRows = useMemo(() => getHomeRows(home), [home]);
  const walletRows = useMemo(() => getWalletRows(snapshot?.wallet.inventory, snapshot?.wallet.received),
    [snapshot?.wallet.inventory, snapshot?.wallet.received]);
  const offers = useMemo(() => getOfferRows(snapshot?.mine ?? [], i18n),
    [i18n, snapshot?.mine]);
  const formView = useMemo(() => {
    const view = getOfferFormView(form, home, i18n);
    if (offers.length >= MARKET_MAX_OPEN_OFFERS)
      return { ...view, problem: view.problem ||
        translateMessage(i18n, M.market.tooManyOffers, { count: MARKET_MAX_OPEN_OFFERS }) };
    return view;
  }, [form, home, i18n, offers.length]);
  const claimable = useMemo(() => walletGoods(walletRows), [walletRows]);
  const others = snapshot?.others;
  const walletInventory = snapshot?.wallet.inventory;
  const buyRows = useMemo(() => getBuyRows(others ?? [], walletInventory ?? {}, home, i18n),
    [home, i18n, others, walletInventory]);
  const pendingBuy = snapshot?.pendingBuy ?? null;
  const pendingOffer = snapshot?.pendingOffer ?? null;
  const pendingClaim = snapshot?.pendingClaim ?? null;

  const onWare = (side: "offered" | "requested", ware: string) => {
    setForm(current => {
      if (side === "requested") return { ...current, requestedWare: ware };
      const available = homeRows.find(row => row.ware === ware)?.count ?? 0;
      const wanted = current.offeredAmount > 0 ? current.offeredAmount : 1;
      return { ...current, offeredAmount: available > 0 ? Math.min(wanted, available) : 0, offeredWare: ware };
    });
  };
  const onAmount = (side: "offered" | "requested", amount: number) =>
    setForm(current => side === "offered" ? { ...current, offeredAmount: amount }
      : { ...current, requestedAmount: clampRequestedAmount(amount) });
  const onTtl = (ttlSeconds: number) => setForm(current => ({ ...current, ttlSeconds }));
  const onOffer = () => {
    if (!market) return;
    const problem = getOfferProblem(form, home, i18n);
    if (problem) { setStatus(problem); return; }
    const draft = getOfferDraft(form);
    void run(() => market.offer(draft), i18n._(M.market.errorOffer), () =>
      setForm(defaultOfferForm(home)));
  };
  const onRetryOffer = () => {
    if (!market) return;
    void run(() => market.retryOffer(), i18n._(M.market.errorRetryOffer));
  };
  const onDiscardOffer = () => {
    market?.discardPendingOffer();
    setSnapshot(current => current && { ...current, pendingOffer: null });
    setStatus(i18n._(M.market.dismissedOffer));
    void load();
  };
  const onClaim = (goods: StockGoods) => {
    if (!market) return;
    void run(() => market.claim(goods), i18n._(M.market.errorClaim));
  };
  const onClaimAll = () => {
    if (!market) return;
    if (!Object.keys(claimable).length) { setStatus(i18n._(M.market.noClaimable)); return; }
    void run(() => market.claim(claimable), i18n._(M.market.errorClaim));
  };
  const onRetryClaim = () => {
    if (!market) return;
    void run(() => market.retryClaim(), i18n._(M.market.errorClaim));
  };
  const onDiscardClaim = () => {
    market?.discardPendingClaim();
    setSnapshot(current => current && { ...current, pendingClaim: null });
    setStatus(i18n._(M.market.dismissedClaim));
    void load();
  };
  const onCancel = (tradeId: string) => {
    if (!market) return;
    void run(() => market.cancel(tradeId), i18n._(M.market.errorCancel));
  };
  const onBuy = (tradeId: string) => {
    if (!market || !snapshot) return;
    const trade = snapshot.others.find(entry => entry.id === tradeId);
    if (!trade) {
      setStatus(i18n._(M.market.errorBuy));
      return;
    }
    void run(() => market.accept(trade), i18n._(M.market.errorBuy));
  };
  const onRetryBuy = () => {
    if (!market) return;
    void run(() => market.retryBuy(), i18n._(M.market.errorRetryBuy));
  };
  const onDiscardBuy = () => {
    market?.discardPendingBuy();
    setSnapshot(current => current && { ...current, pendingBuy: null });
    setStatus(i18n._(M.market.dismissedBuy));
    void load();
  };
  const onRefresh = () => void load(i18n._(M.market.success));

  return {
    available: Boolean(market),
    busy,
    buyRows,
    error,
    form: formView,
    homeOnly,
    homeRows,
    loaded: snapshot !== null,
    loading,
    offers,
    pendingBuy,
    pendingClaim,
    pendingOffer,
    status,
    walletRows,
    walletTotal: totalRows(walletRows),
    onAmount,
    onBuy,
    onCancel,
    onClaim,
    onClaimAll,
    onDiscardBuy,
    onDiscardClaim,
    onDiscardOffer,
    onOffer,
    onRefresh,
    onRetryBuy,
    onRetryClaim,
    onRetryOffer,
    onTtl,
    onWare
  };
};

export type MarketViewState = ReturnType<typeof useMarket>;
