# Manual gameplay acceptance

This command launches a long native-GPU browser session only when explicitly invoked:

```sh
npm run test:e2e:full -- --quality high,minimal
```

Do not add it to ordinary tests, CI, watch mode or a schedule. It defaults to headed Chrome,
512×512 UI generation, separate profiles and serial lanes. `--help` launches no browser.
`CHROME_PATH`, `GPU=igpu`, `WORKER_REPO` and `FFMPEG_PATH` select host dependencies.
Native Chrome and ffmpeg must already be installed. Missing video encoding is retained as an
artifact error, never represented as a successful clip. `--no-video` is an explicit opt-out.

Implemented lanes:

- `generator`: real generator controls and structural/resource inventory; no silent reroll.
- `natural`: well/woodcutter placement and roads, actual builders/materials, three completed
  cycles with source-attributed pickups and same-carrier storage handoffs, and quest-journal
  interactions. Global storage growth alone cannot pass production.
- `controls`: ordinary camera gestures and zoom limits with ground/building picking, minimap
  open/close plus click-to-locate, Main selection open/close, arrow/left-drag camera input,
  and Observe worker follow/stop. A natural checkpoint supplies the real worker when available;
  a standalone run places one well foundation through the build and road UI to obtain a builder.
- `catalog`: actual debug build-all button, catalog placement reconciliation, narrow terrain
  comparisons and bounded wall-clock production/traffic samples. The debug assist is recorded.
- `production`: real mode controls, delivered production cycles and finite-material upgrades for
  the actual player's nation. Missing buildings, supplies and specialized vehicle ownership proofs
  remain blocked; individual mode/upgrade results feed coverage directly.
- `progression`: real UI sequential road transitions through all six tiers and live colony pair
  source-identity checks. Missing finite material supplies or uncaptured tier checkpoints are blocked.
  This does not prove loaded carts, exact payment isolation or historical discovery.
- `traffic`: finite-stone road upgrade, public-edge removal/reconnection and observed recovery of
  the affected loaded carriers. Legitimate waits and suspected stalls stay separate.
- `military`: real Military Academy recruitment, natural military construction, garrison expansion and
  rally/cancel controls from sufficient finite-stock checkpoints.
- `quests`: actual eligible tutorial/daily progression, claims and export/import reward checks.
- `ships`: actual current-island register manifests, route/ETA presentation and navigation.
- `colony` / `adventure`: ordinary expedition planning/departure, bounded real-time arrival,
  actual UI combat, local finite-stock construction/upgrades, survivor recall and homeward receipt.
  Checkpoints and reproduction prefixes are linked through island transitions.
- `continuous`: colony → home → adventure in one context from one finite expedition-ready
  checkpoint. A failed prerequisite or first-leg conquest/return/receipt stops continuation.
  A genuinely fresh HQ runs the minimum natural F0 economy/recruitment prelude; a developed
  checkpoint never receives inferred F0 history. Harbour/ships and sufficient force remain separate prerequisites.
- `persistence`: real UI export/import during any actually active construction, carrying,
  production, upgrade, recruitment, rally, combat or expedition phase. Missing phases are blocked.
- `performance`: exclusive foreground frame/heap/stock/actor stability observation of an active
  settlement. It requires at least four buildings; no troops or supplies are injected.
  This lane disables Playwright tracing, contextual video and reproduction recording even when
  other lanes record them. Case-end screenshots/reports occur after the measurement window.

Use `--lane production`, `--lane military`, `--lane quests`, `--lane ships`, `--lane colony`,
`--lane adventure` or `--lane controls` to select these scenarios explicitly. `--lane all` includes
every lane.
Missing progression/supplies/offers are blocked prerequisites, not permission to grant resources.
Within one run, generation establishes the common baseline. Natural/catalog branches remain
isolated; production and performance may fork the catalog result, persistence may fork natural
or catalog, controls may fork natural, while military/quests/ships/voyages fork the common or
supplied baseline.
Supply a legitimately prepared checkpoint with `--resume` for later-stage branches.

Every lane writes an immutable matching game/map checkpoint. The map is decoded from the game's
embedded map, rather than exported at a later time. Import it into a separate context with:

```sh
npm run test:e2e:full -- --lane natural --quality minimal \
  --resume /absolute/checkpoint/directory
```

A checkpoint directory contains `manifest.json`, `game.json` and `world.island`. The manifest is
portable and verifies content hashes, stable terrain and source/asset/worker versions. A map
alone does not contain actors, logistics, survey progress or voyages. The runner verifies the
working source/assets before each case and at the end. Editing those files invalidates the run.
A resume makes a new result directory and never overwrites a previous checkpoint.

Artifacts default to `resources/project-reviews/full-e2e/<UTC-run-id>/` beside this checkout:
HTML and JSON case reports, coverage obligations, screenshots, bounded eight-second contextual
clips, bounded per-case Playwright trace windows (both disabled for performance), browser logs, failure snapshots, checkpoints
and UI reproduction exports.
Use `npx playwright show-trace <trace.zip>` with a compatible Playwright installation for traces.
Reproduction exports are per-island segments; exact replay is a separate explicit command.
The existing replay tools do not support a continuous multi-island/editor visual timeline.

Coverage is deliberately granular. Passing a production observation does not pass every mode;
a terrain delta report does not replace visual review. `coverage.json` maps executed per-mode/upgrade
outcomes to the observed player nation and lists every explicit obligation with its derived outcome.

`obligation-registry.ts` is the typed obligation registry. Each obligation lists the concrete case IDs
that prove it (templated IDs resolve from `ROAD_TIERS`, `COLONY_RESOURCE_TIERS`, the persistence phases,
recruit troop types, prelude chain, journey kinds and the player's `createAcceptanceManifest` catalog)
plus the sub-requirements that no implemented case covers yet. `obligation-outcomes.ts` derives each
obligation from one lane report's real outcomes: `fail` if a required case failed, `blocked` if one is
blocked, `not-run` if a case is missing/not-run or an uncovered sub-requirement exists, `not-run`
("Awaiting review") while any passing case is unreviewed, and `pass` only when every required case
passed and is reviewed. All required cases must be present in the same lane report. Parent tasks are
complete only when all of their obligations pass in both High and Minimal.

Only `E2E-12-reward-progression` is currently fully backed by implemented cases. The other obligations
name their missing coverage, including two structural gaps: one progression checkpoint proves at most
one colony tier pair, and sawmill recipe modes above level 1 run before the upgrades that unlock them.

Evidence produced by a live run is necessarily unreviewed, so a live run exits at best with `2`.
After inspecting the artifacts, a reviewer writes `reviewed-evidence.json` into the run directory:

```json
{ "reviews": [
  { "caseId": "E2E-12-claim-reload", "lane": "quests", "quality": "high",
    "reviewer": "owner", "note": "Claim, reload and unchanged XP inspected in clip and state" }
] }
```

Every field is required and a review only applies to that case in that lane and quality. Then run
`npm run test:e2e:full -- --reconcile /path/to/run` (no browser). It re-derives obligations from the
recorded lane reports, writes `reviewed-coverage.json` (including reviews that match no executed case)
and leaves the recorded reports and `coverage.json` untouched. Its exit status follows the rules below
and always requires both qualities. The uninterrupted cross-lane
journey from a pristine F0 through natural economy/recruitment, complete conquest variants and
failure branches, every vehicle/service mode, contextual animation matrix and troop/voyage stress
branches remain broader obligations. This runner exposes partial scenarios with granular outcomes;
its implementation does not establish a full-game pass.

No browser acceptance or gameplay test was executed while implementing this runner, following
the owner's request to keep testing stopped. TypeScript compilation is a static check only.

Exit status distinguishes evidence from a full pass: `1` means failed/aborted cases; `2` means
blocked, not-run or unreviewed obligations remain without observed failures; `0` requires complete,
reviewed coverage (reachable only through `--reconcile`).
A narrow selected lane intentionally leaves broader requirements not-run, so its successful
individual cases can coexist with exit status `2`. Read the case matrix for the scoped results.

Latest progression obligations are derived from shared catalogs, not from a fixed Roman list:
all five sawmill plank recipes, four sequential matching-log/stone builder upgrades, all six
road tiers and four colony resource pairs. Hidden legacy sawmill definitions remain in the
manifest with `buildable:false`, so new catalog placement does not pretend to create them.
Production attempts unlocked recipes through their actual icon buttons; after each paid sawmill
upgrade it observes the newly unlocked recipe with source-attributed storage deliveries.

Checkpoint manifests optionally include a verified `progression` profile describing saved
sawmill levels/selection, road counts and finite colony deposits. This is current-state metadata,
not evidence of how those states were reached. `coverage.json` lists uncaptured finite tier and
authentic legacy fixtures explicitly. Historical pending-upgrade/legacy-sawmill/mixed-road saves
have not been captured by this implementation and are not reconstructed as passes.

These cases are written for a later explicitly requested gameplay run. Static typechecking is
not runtime acceptance. Full F0-to-voyage infrastructure, per-ware concurrent economy conservation,
mid-cycle manual recipe selection across reload, loaded carts on every road tier, exhaustive
animations, discovered-tier distribution and authentic legacy restore remain larger obligations.

Natural production, the F0 prelude and catalog production share the same read-only RAF attribution
observer. It records pickups from the selected producer and completed handoffs by those carriers
into identified storage. Cancellation/redirection invalidates pending receipts; preexisting loaded
cargo and cart batches do not count as unit deliveries. Three source cycles and three receipts are
required in the natural branch. Aggregate stock is retained as context even when other consumers
spend deliveries immediately. These observations do not independently conserve every ware or prove
that each delivery came from a particular newly completed batch. Regression cases are written and
unrun; no browser acceptance was executed for this change.

## Current media and recording context

Clips wait for the first actual CDP screencast frame before the case action begins. Startup fails
explicitly after five seconds without a frame; the report retains encoding/startup failures.
Immediately completed cases retain a real one-frame clip rather than a zero-frame encoding.
Clips remain bounded to eight seconds and at most ten accepted frames per second.

Tracing is bounded to each case's first eight seconds, with screenshots enabled and DOM snapshots
and source copies disabled. Long failed cases also capture up to three seconds around their failure
state/screenshot collection. Reports link prefix/failure trace files separately and retain failures,
state snapshots, screenshots and command recordings. No lane-wide full-duration trace is implied.
Performance lanes still disable video, traces and reproduction recording.

The bench server's existing unlock-all setting is recorded explicitly as an assist. These cases
can prove finite-material construction and actual worker execution; they do not prove natural
building unlock progression. Scene recordings preserve the explicit unlock-all setting so replay
follows the same placement checks; strict ordering and normal player-level gates remain enforced.
