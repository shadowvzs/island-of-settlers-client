import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { MeshStandardMaterial, Texture } from "three";
import { createServer } from "vite";

import type { BuildingSurface } from "../../src/render-common/buildings/building-recipe";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { createWisteriaHero } = await server.ssrLoadModule("/src/renderers/three/wisteria-hero.ts") as
    typeof import("../../src/renderers/three/wisteria-hero");
  const { createWisteriaMinimalTemplates } = await server.ssrLoadModule(
    "/src/renderers/three/wisteria-minimal-templates.ts"
  ) as typeof import("../../src/renderers/three/wisteria-minimal-templates");
  const { createWisteriaProductionModels } = await server.ssrLoadModule("/src/renderers/three/wisteria-production-model.ts") as
    typeof import("../../src/renderers/three/wisteria-production-model");
  const metadata = JSON.parse(readFileSync("assets/botanical-textures/wisteria-owned-lod-atlas-candidate.json", "utf8"));
  const wood = new MeshStandardMaterial();
  try {
    for (const frame of ["curved", "lattice", "pergola"] as const) {
      const original = createWisteriaHero({ wood } as Record<BuildingSurface, MeshStandardMaterial>, undefined, { frame });
      const botanyHash = createHash("sha256").update(JSON.stringify(original.botany)).digest("hex");
      original.dispose();
      for (const detailed of [true, false]) {
        const factory = createWisteriaProductionModels({ wood } as Record<BuildingSurface, MeshStandardMaterial>, detailed, async () => new Texture(), async () => new Texture());
        for (const tier of ["near", "far"] as const) {
          const runtime = await factory.create(frame, undefined, tier);
          console.log(JSON.stringify({ runtime: true, frame, detailed, tier, triangles: runtime.triangles }));
          runtime.dispose();
        }
      }
      for (const minimal of [false, true]) {
        const templates = createWisteriaMinimalTemplates(new Texture(), metadata);
        const model = createWisteriaHero({ wood } as Record<BuildingSurface, MeshStandardMaterial>, templates, { frame, minimal, coarseBotany: true });
        console.log(JSON.stringify({ frame, minimal, botanyHash, counts: model.counts,
          triangles: model.topology.reduce((sum, surface) => sum + surface.visibleTriangles, 0), topology: model.topology }));
        model.dispose(); templates.dispose();
      }
    }
  } finally { wood.dispose(); }
} finally { await server.close(); }
