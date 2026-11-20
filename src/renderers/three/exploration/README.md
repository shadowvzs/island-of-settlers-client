# Home-island exploration visuals (EXPLORE-01C)

This directory is renderer-only. It does not add a simulation actor, a save field, a second scene or a
second render loop. The coordinator (01G) owns wiring; the shared isometric camera and renderer remain
untouched.

## Integration points

- `createExplorationCameraRig({ groundHeight, ...tuning })` returns a persistent `PerspectiveCamera`.
  Call `update(savedRtsSnapshot, frame.camera)` each frame that the exploration camera override is
  present and use `rig.camera` for that render. Keep passing the unchanged RTS `CameraState` to save,
  wildlife and ordinary picking code. `update` never writes to the supplied state. Pose convention:
  yaw 0 faces +Z and positive yaw turns towards +X; pitch is up-positive. `explorationLookDirection`
  exports the same convention for movement/look input code.
- `createExplorationAppearanceAdapter({ parent, loader, portrait, groundHeight })` is the frozen
  `ExplorationAppearanceAdapter` plus `dispose()`/`stats()`. It resolves the portrait nation through
  the canonical Tripo body recipe, adds a telescope, hides the body at eye view and releases its body
  lease, mixer, materials, skeleton and telescope exactly once. Use
  `createSharedExplorationBodyLoader(pool)` with the settlement's existing `createWorkerBodyPool` so
  shared assets remain for ordinary workers, or `createOwnedExplorationBodyLoader(textures)` for an
  explorer-only pack. `lease.dispose()` releases the body, mixer, material/skeleton clones and
  telescope; `adapter.dispose()` additionally drops the loader shell and is the terminal teardown used
  on session replacement.
- The lease's `eyeHeight()` returns the measured rig eye height (~0.97 world units, matching a normal worker for the default
  1.8-unit body); pass it to the camera's `eyeHeight` tuning and the controller's pose.
- `createExplorationSmokeAdapter({ parent })` implements the frozen smoke contract. `burst()` starts a
  presentation-clock fade for callers without frame progress; `update(frame.smoke)` renders/clears the
  frozen frame. The pool is fixed at 40 sprites and uses its own seeded presentation PRNG.
- `createExplorationLodAdapter(quality)` maps eye distance to FPS-specific plant/terrain/rock/impostor
  settings and a bounded current-island draw distance. It never asks for catalog prefetch or another
  island.

## Asset gaps (honest)

- The Tripo bodies bake skin, head/face, hair and facial hair into one body file. There are no
  independent selectors, so the explorer matches the portrait nation, body variant and gender only.
- Every Tripo body is one skinned mesh named `body`. A separate head/hair mesh does not exist, so the
  full explorer group is hidden at eye view rather than partially clipping the head through the near
  plane.
- The worker pack has no spyglass prop. The explorer uses the canonical `spyglassParts` icon model
  (`createSpyglassIconModel`) as its carried telescope.

## Checks

Focused tests: `island-of-settlers-client/tests/exploration-camera.test.ts`, `exploration-appearance.test.ts`,
`exploration-appearance-smoke.test.ts`, `exploration-appearance-lod.test.ts`. Typecheck:
`npx tsc --noEmit`.
