# Offline catch-up acceptance tools

## Browser-worker timing

`offline-browser-worker.ts` starts the game's Vite server, opens a dedicated page and runs the real
`advanceOfflineGame` inside the shipped game-session Worker. It reports wall time, worker time, game
seconds, actual mode, fallback reason, fixed ticks/skips and the cost of resuming 60 s on the
caught-up save.

```sh
cd client
WORKER_REPO="/home/shadowvzs/personal/island of settlers/worker-generation" \
  npx tsx tools/acceptance/offline-browser-worker.ts --mode measured --seconds 3600 \
  --out ../resources/offline-acceptance-current/browser-worker-1h-measured.json

# 2 h scaling probe (largest completed; the tool supports up to 6 h but a 6 h run was not completed)
WORKER_REPO="/home/shadowvzs/personal/island of settlers/worker-generation" \
  npx tsx tools/acceptance/offline-browser-worker.ts --mode measured --seconds 7200 --memory \
  --out ../resources/offline-acceptance-current/browser-worker-2h-measured.json
WORKER_REPO="/home/shadowvzs/personal/island of settlers/worker-generation" \
  npx tsx tools/acceptance/offline-browser-worker.ts --mode exact --seconds 7200 --memory \
  --out ../resources/offline-acceptance-current/browser-worker-2h-exact.json
```

Modes: `measured` (default), `exact`, `event-core`, `executor`, `quiet`, `movement`,
`chronological`. The horizon is capped at 6 h so this cannot silently become the 24 h benchmark.
This is a browser CPU measurement, not a phone or isolated benchmark.

The report records host load average at the start and end. Treat a run whose load average is not
near idle as a contention-sensitive observation, not an isolated budget.

`--memory` adds a coarse page-renderer JS heap sample from Chrome's quantized
`window.performance.memory`. It is not the game-session worker isolate and not process RSS; use it
only as a trend.

## Focused visual/parity run

`island-of-settlers-client/tests-ui/offline/offline-catch-up.spec.ts` seeds a save one hour in the past, loads the
normal game URL, lets the client catch up in its worker and checks the live settlement, the
committed save, clock stability and the Build panel. It writes a screenshot and state JSON with
`timeToSettlementMs` and `timeToUsableUiMs` (navigation start to the settled island and to the
closed Build panel). The second case reuses the same seed/startup path at a mobile/low-end viewport:
390×844 CSS pixels at DPR 1, `isMobile` and touch. It checks the player HUD and bottom bar inside
the viewport (no sideways page scroll), the Build panel inside the viewport, the same clock
stability, and the committed save.

`OFFLINE_ACCEPTANCE_FIXTURE` selects the save read in Node and served to the seed page; it defaults
to `public/demo/continued-0.json` and accepts a path outside `public/`. `OFFLINE_ACCEPTANCE_ARTIFACT_PREFIX`
overrides the `visual-1h`/`visual-24h` evidence name so another fixture does not overwrite the
developed-fixture artifacts.

```sh
cd client
WORKER_REPO="/home/shadowvzs/personal/island of settlers/worker-generation" \
  npx playwright test --project=offline-catch-up --reporter=line
# mobile case only:
WORKER_REPO="/home/shadowvzs/personal/island of settlers/worker-generation" \
  npx playwright test --project=offline-catch-up --grep "mobile/low-end" --reporter=line
# or (both cases, no tracked artifacts): npm run test:offline
```

Set `OFFLINE_ACCEPTANCE_ARTIFACTS` to publish both screenshots/state to a fixed directory. Set
`OFFLINE_ACCEPTANCE_HORIZON_SECONDS` to run a longer visual check; it uses the normal client duration
policy (native below 30 minutes, fast economy at/above 30 minutes) and does not change the 6 h
worker-timing cap. A non-default fixture example:

```sh
OFFLINE_ACCEPTANCE_HORIZON_SECONDS=3600 \
OFFLINE_ACCEPTANCE_FIXTURE=../resources/offline-economy/horse-free-2026-10-26/input.json \
OFFLINE_ACCEPTANCE_ARTIFACT_PREFIX=ui-owner-1h \
OFFLINE_ACCEPTANCE_ARTIFACTS=../resources/offline-economy/final-acceptance-2026-10-27 \
  npx playwright test --project=offline-catch-up --grep "renders and stays usable" --reporter=line
```



```sh
OFFLINE_ACCEPTANCE_ARTIFACTS=../resources/offline-acceptance-current \
WORKER_REPO="/home/shadowvzs/personal/island of settlers/worker-generation" \
  npx playwright test --project=offline-catch-up --reporter=line
```

The project is isolated from `test:ui` and `test:visual`; do not add it to broad suites. A longer
visual run is a separate acceptance operation, not a routine test:

```sh
OFFLINE_ACCEPTANCE_HORIZON_SECONDS=86400 \
OFFLINE_ACCEPTANCE_ARTIFACTS=../resources/offline-acceptance-current \
WORKER_REPO="/home/shadowvzs/personal/island of settlers/worker-generation" \
  npx playwright test --project=offline-catch-up --grep "renders and stays usable" --reporter=line
```

## Evidence

- `docs/archive/dated/offline-catch-up-acceptance-2026-10-23.md`
- `resources/offline-acceptance-current/browser-worker-1h-{measured,exact}.json`
- `resources/offline-acceptance-current/browser-worker-2h-{measured,exact}.json` (scaling probe)
- `resources/offline-acceptance-current/visual-1h.png` and `visual-1h-state.json`
- `resources/offline-acceptance-current/visual-1h-mobile.png` and `visual-1h-mobile-state.json`

## Campaign IndexedDB repository

`campaign-indexeddb-check.ts` starts the Vite dev server and runs the campaign repository contract's core
cases (revisions, conflicts, campaign/state filters, image bytes, delete) over the real IndexedDB store in
Chrome; Node unit tests cover the same contract over the memory store.

```sh
cd island-of-settlers-client
/media/shadowvzs/a3016bc8-b7d7-4116-b510-dad892792829/home/shadowvzs/worktree/captures/browser-slot.sh \
  npx tsx tools/acceptance/campaign-indexeddb-check.ts
```
