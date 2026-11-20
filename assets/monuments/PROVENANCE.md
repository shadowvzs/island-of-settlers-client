# Provenance and preview scope

The supplied user reference photographs were used as design references for the stave roof hierarchy and the middle pagoda's overall form. No photographed church, stock pagoda mesh, downloaded animal model, or image texture from those references was embedded into the revised GLBs. Geometry and texture fields were authored with the supplied deterministic Python source. Shared geometric utilities and the illustrative render staging are adapted from the previously delivered source pack in this conversation.

The new lion begins as a blended implicit anatomical sculpture sampled to a continuous mesh, then reduced before separate tail/tuft and tiny carving details are attached. The main body is not an assembly of separate visible spheres. The high-resolution intermediate PLY is supplied for editing; it is not embedded into the runtime building GLB.

Relief ornament is newly specified geometric decoration, not a claim to reproduce a specific historic inscription. National labels identify intended in-game factions, not archaeological certification. In particular the Norse stave-like building follows the user's medieval reference direction, and the tall pagoda is a stylized reference-led East Asian design rather than a certified Japanese historical reconstruction.

All context images were rendered from the final exported GLBs with VTK. No generated concept illustration is substituted for a model preview. Scene staging is newly authored proxy geometry and does not establish native game integration. The old lion comparison is isolated from the originally supplied Nubian GLB and rendered with a neutral material; it is included only for comparison, not offered as a revised asset.

This provenance record is not a legal clearance, uniqueness or exclusivity guarantee. It documents the inputs and production method. No unrelated soundtrack, commercial image or source game archive is repackaged here.

Software references for reproducibility: glTF 2.0 specification (Khronos); VTK glTF importer and quadric decimation; Trimesh; NumPy; SciPy; scikit-image; Pillow. Runtime assets do not embed those Python libraries. Font files used locally to rasterize headings are not distributed.

## Japanese continuity repair, 2026-10-31

`japanese-continuous-high.glb` and `japanese-continuous-minimal.glb` are processed runtime siblings;
the supplied `japanese-high.glb` and `japanese-minimal.glb` remain byte-identical rollback sources.
`tools/assets/japanese-monument-continuity.py` adds red wall heads following the actual roof triangles,
timber roof soffits, the floor diaphragms omitted from Minimal, ground-portico bearing blocks and
cream fascia joint caps. Original geometry, scene nodes, materials and embedded PBR images remain
unchanged. Additions join the existing material batches, preserving mesh/draw-call counts and bounds.
`japanese-continuity.json` records reproducible hashes and triangle additions. Native all-side,
low-eye and real possessed/spyglass captures are under
`resources/project-reviews/japanese-monument-continuity` in the game workspace.
