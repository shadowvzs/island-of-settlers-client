# Camera air and presentation boundaries

`atmosphere-height.ts` and `atmosphere-ray.ts` are pure CPU math. `atmosphere-glsl.ts`
provides the same analytical height integral and finite world-space ray contract. Perspective
rays retain the actual eye-to-surface path; orthographic rays stay parallel and use the current
view depth (zoom) when supplied, so close strategic views do not keep a fixed volume-length fog.
Optical-depth integration owns the single AABB clip. Below the reference height density is
constant; above it density falls exponentially. No marching texture, GPU target, scene resource,
simulation clock, gameplay RNG or save data belongs here.

`concealment-glsl.ts` is separate presentation logic: it reads the already composed exploration
visibility texture along a 3D ray. Its soft height falloff avoids an infinite sky column. It never
changes the weather field or authoritative discovery. The temporary moving reveal is preserved.

`view-limit-glsl.ts` is a separate clipping veil on walking geometry. It closes the final40%
of the camera's forward-depth range before the far plane, where a hard cut would otherwise expose
a seam against the sky. It uses the same airlight; spyglass changes this boundary only. Sky rays
use the physical envelope and do not receive a view-limit ceiling. Default far0 disables the veil.

Every material composes camera air once, in linear light, before the shared colour output
(`shaders/color-output-glsl.ts`, R04): raw shaders decode their display-authored colour and
call `finishColor`/`finishSurface`; built-in Three materials compose before the tonemapper slot.
The airlight uniform is the linear, ungraded fog colour, because the output grades every fogged
pixel afterwards. Zero camera air preserves the unfogged output.

Three runtime state, pass scoping and material hooks live in `renderers/three/atmosphere/`.
Ordinary scenes and actual used pooled/shared materials bind once, with renderer-scoped hooks;
submitted-mesh callbacks cover later material replacement without repeated scene traversal.
Disposal restores hooks, listeners and renderer methods. Source model templates that never enter
a runtime scene are not visited. Shadow/refraction captures exclude camera air; shader permission
discards remain. The blended water path needs a genuinely unfogged bed and adjusted source alpha.

One height layer is enabled; optional analytical banks are deliberately absent until independently
justified by appearance and measured cost. Run targeted math/material/lifetime tests and
`tools/bench/atmosphere-review.ts` for native float precision, composition and resource checks.
