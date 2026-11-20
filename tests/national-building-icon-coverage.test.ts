import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { BuildingIcon } from "../src/app/components/building-icon";
import { getNationBuildingIconSource, setSettlementBuildingIconNation } from "../src/app/settlement-ui/building-icons";
import { nationalBuildingIconPath } from "../src/render-common/buildings/building-icon-path";
import { buildingAssetCodes, buildingAssetNations } from "../tools/bench/building-asset-targets";

it("routes every catalog nation/building icon through actual PNG files and the real BuildingIcon component", () => {
  vi.stubGlobal("document", { querySelectorAll: () => [] });
  try {
    const unique = new Set<string>(), codes = buildingAssetCodes(), nations = buildingAssetNations();
    for (const nation of nations) {
      setSettlementBuildingIconNation(nation);
      for (const id of codes) {
        const path = nationalBuildingIconPath(nation, id);
        expect(existsSync(path), path).toBe(true);
        const bytes = readFileSync(path);
        expect([...bytes.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
        const source = getNationBuildingIconSource(id,nation);
        expect(source, path).toContain(`${nation}-${id}.png`);
        unique.add(source!);
        const markup = renderToStaticMarkup(createElement(BuildingIcon,{type:id}));
        expect(markup).toContain(`src="${source}"`);
        expect(markup).toContain(`data-building-icon="${id}"`);
        expect(markup).not.toContain('data-icon="build"');
      }
    }
    expect(codes).toHaveLength(57);
    expect(unique.size).toBe(nations.length * codes.length);
    expect(unique.size).toBe(456);
    expect(getNationBuildingIconSource(9999,"maya")).toBeUndefined();
  } finally { setSettlementBuildingIconNation("roman");vi.unstubAllGlobals(); }
});
