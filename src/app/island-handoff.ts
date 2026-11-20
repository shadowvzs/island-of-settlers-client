import type { GameSaveV1 } from "../shared/settlement/game-save";
import {
  type HandoffReceipt,
  type HandoffResourceSample
} from "./handoff-receipt";
import {
  type SessionLifecycle,
  type SessionToken,
  SessionTransitionCancelled,
  SessionTransitionReloadRequired
} from "./session-lifecycle";
import {
  type HandoffRefusal,
  IN_PAGE_HANDOFF_TRIGGERS,
  type IslandHandoffTrigger
} from "./settlement/island-handoff-policy";

/** The prepared destination kinds; payloads stay opaque to the ordering coordinator. */
export type IslandDestination =
  | { kind: "saved"; payload: GameSaveV1; targetKey: string }
  | { kind: "visit"; payload: unknown; targetKey: string }
  | { kind: "new"; choice: unknown; seed: number; targetKey: string }
  | { kind: "map"; slotId: string; targetKey: string }
  | { kind: "import"; targetKey: string; value: unknown };

export interface IslandHandoffPlan {
  destination: IslandDestination;
  /** A departure already captured by travel, avoiding a second serialization. */
  departure?: GameSaveV1;
  /** Travel saves the departing island; import/new/editor replacement do not. */
  saveDeparture: boolean;
}

export type IslandHandoffRequest = {
  /** Coalescing key (`travel:7`, `travel:home`, `import`). */
  key: string;
  trigger: IslandHandoffTrigger;
} & (IslandHandoffPlan | {
  /** Captures travel state only after the lifecycle freezes and accepted saves settle. */
  resolve: (token: SessionToken) => Promise<IslandHandoffPlan>;
});

export type IslandHandoffFailureReason =
  | HandoffRefusal
  | "busy"
  | "cancelled"
  | "failed"
  | "reload-required"
  | "stale";

export type IslandHandoffResult<Prepared, Session> =
  | { coalesced: boolean; ok: true; prepared: Prepared; session: Session }
  | {
      coalesced?: boolean;
      error?: unknown;
      ok: false;
      reason: IslandHandoffFailureReason;
    };

/**
 * The app-owned side of a handoff. Preparation is CPU-only; commit makes the destination the
 * authoritative saved/startup game; only then may the old session be disposed and the new one installed.
 * Any failure after the commit must reload the committed destination rather than resume the old island.
 */
export interface IslandHandoffServices<Prepared, Session> {
  /** Captures the active island's save (the caller settles in-flight writes first). */
  captureDeparture: () => Promise<GameSaveV1>;
  /** Validates/catches up the destination and builds its CPU-side island state. */
  commitDestination: (prepared: Prepared) => Promise<void>;
  /** Removes the durable reload fallback only after the new island is ready. */
  complete?: () => Promise<void>;
  current: () => Session | null;
  dispose: (session: Session) => Promise<void> | void;
  /** Triggers this document currently supports; defaults to the first in-page slice. */
  enabledTriggers?: ReadonlySet<IslandHandoffTrigger>;
  /** Installs the prepared island, including its renderer/UI, and returns the new session. */
  install: (prepared: Prepared) => Promise<Session>;
  /** Hide the page loading screen after the destination is installed (or the old island resumed). */
  hideLoading?: () => void;
  /** Show/set up the page loading screen before freezing and tearing down the old island. */
  showLoading?: () => Promise<void> | void;
  /** Confirms the caught-up destination still names the requested island/player/map identity. */
  matches: (prepared: Prepared, destination: IslandDestination) => boolean;
  prepare: (destination: IslandDestination, token: SessionToken) => Promise<Prepared>;
  /** Optional timing/resource receipt; the caller discards it with the handoff. */
  receipt?: HandoffReceipt;
  /** Optional live resource counts sampled before and after the handoff. */
  sampleResources?: () => HandoffResourceSample;
  settle?: () => Promise<void>;
  transition: SessionLifecycle;
  writeDeparture: (departure: GameSaveV1) => Promise<void>;
}

/**
 * Page-level ordering for a same-document island replacement. This module deliberately contains no
 * simulation, renderer or save policy: it freezes through `SessionLifecycle`, writes the departure,
 * prepares and commits the destination, then disposes the old session and installs the new one.
 */
export const createIslandHandoff = <Prepared, Session>(
  services: IslandHandoffServices<Prepared, Session>
) => {
  const enabled = services.enabledTriggers ?? IN_PAGE_HANDOFF_TRIGGERS;

  const replace = async (
    request: IslandHandoffRequest
  ): Promise<IslandHandoffResult<Prepared, Session>> => {
    if (!enabled.has(request.trigger))
      return { ok: false, reason: "trigger-not-enabled" };
    if (!services.current()) return { ok: false, reason: "failed" };

    const receipt = services.receipt;
    const mark = (phase: Parameters<NonNullable<typeof receipt>["mark"]>[0]) => receipt?.mark(phase);
    receipt?.sample(services.sampleResources?.() ?? {});
    let loadingShown = false;
    const outcome = await services.transition.run<{ prepared: Prepared; session: Session }>({
      key: request.key,
      replaceSession: true,
      run: async token => {
        loadingShown = true;
        await services.showLoading?.();
        mark("freeze");
        mark("settle");
        await services.settle?.();
        if (!token.current()) throw new SessionTransitionCancelled();
        const plan = "resolve" in request ? await request.resolve(token) : request;
        if (!token.current()) throw new SessionTransitionCancelled();
        if (plan.saveDeparture) {
          mark("departure-capture");
          const departure = plan.departure ?? await services.captureDeparture();
          if (!token.current()) throw new SessionTransitionCancelled();
          mark("departure-write");
          await services.writeDeparture(departure);
          if (!token.current()) throw new SessionTransitionCancelled();
        }
        mark("prepare");
        const prepared = await services.prepare(plan.destination, token);
        if (!token.current()) throw new SessionTransitionCancelled();
        if (!services.matches(prepared, plan.destination))
          throw new Error("Destination changed during preparation");
        mark("destination-commit");
        await services.commitDestination(prepared);
        // From here the destination is authoritative: any failure must reload it, never resume the
        // departing island. The lifecycle keeps commands frozen and invalidates older work.
        if (!token.current()) throw new SessionTransitionReloadRequired();
        try {
          mark("dispose");
          const old = services.current();
          if (old) await services.dispose(old);
          mark("install");
          const session = await services.install(prepared);
          await services.complete?.();
          mark("activate");
          return { prepared, session };
        } catch {
          throw new SessionTransitionReloadRequired();
        }
      }
    });
    if (!outcome.ok) {
      if (outcome.reason === "reload-required") {
        // Keep the loading screen up: the committed destination is about to reload.
        mark("reload-required");
        receipt?.sample(services.sampleResources?.() ?? {});
        return outcome;
      }
      if (outcome.reason !== "busy") mark("resume-old");
    }
    if (loadingShown) {
      services.hideLoading?.();
      receipt?.sample(services.sampleResources?.() ?? {});
    }
    if (!outcome.ok) return outcome;
    return { coalesced: outcome.coalesced, ok: true, ...outcome.value };
  };

  return { replace };
};

export type IslandHandoff<Prepared, Session> = ReturnType<
  typeof createIslandHandoff<Prepared, Session>
>;
