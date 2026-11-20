import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditorHistory } from "../src/app/map-editor/editor-history";
import { createEditorStore } from "../src/app/map-editor/editor-store";
import { resolveEditorText } from "../src/app/map-editor/messages";
import { createOriginalFeatureSelector } from "../src/app/map-editor/original-feature-selector";
import type { TerrainRenderer } from "../src/render-common/renderer-contract";
import { createTerrainEditState } from "../src/shared/world/editing/terrain/terrain-edit-state";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld } from "./helpers/cached-worlds";

const noop = () => {};

describe("original source identity recovery", () => {
  beforeEach(() => { vi.stubGlobal("document", { createElement: () => ({ setAttribute: noop, style: {} }) }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("reports the recovered identities even while a source outline is shown", async () => {
    const generated = cachedWorld(SMALL_EDITOR_WORLD), world = structuredClone(generated);
    const identities = world.generatedFeatureIdentities!;
    expect(identities.length).toBeGreaterThan(0);
    const history = createEditorHistory({ animals: { list: () => [], place: () => true, remove: noop },
      flush: noop, isQueued: () => false, rebuild: noop, terrain: createTerrainEditState(), world });
    const renderer = { pickGround: () => null } as unknown as TerrainRenderer;
    const viewport = { append: noop, clientHeight: 0, clientWidth: 0 } as unknown as HTMLElement;
    const selector = createOriginalFeatureSelector(world, viewport, renderer, history, createEditorStore(), noop,
      () => false, () => Promise.resolve(structuredClone(generated)));
    selector.choose(String(identities[0]!.id));
    await selector.recover();
    expect(resolveEditorText(undefined, selector.section.get().status)).toBe(
      `Recovered ${identities.length} original source identities. Terrain, props and paints were kept.`);
  });
});
