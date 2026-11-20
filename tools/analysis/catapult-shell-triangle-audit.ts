import { type BufferGeometry, MeshStandardMaterial } from "three";
import { createServer } from "vite";

const server = await createServer({ appType: "custom", server: { hmr: false, middlewareMode: true } });
try {
  const { getBuildingDefinition } = await server.ssrLoadModule("/src/render-common/buildings/building-catalog.ts");
  const { leveledBuildingRecipe } = await server.ssrLoadModule("/src/render-common/buildings/levels/leveled-building-recipe.ts");
  const { createRomanBuilding, createRomanPartGeometry } = await server.ssrLoadModule("/src/renderers/three/buildings/roman-building.ts");
  const { NATION_SURFACES, ROMAN_SURFACE_COLOURS } = await server.ssrLoadModule("/src/renderers/three/buildings/building-surface-paint.ts");
  const detailed = process.argv.includes("--high"), nations = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
  for (const nation of nations.length ? nations : ["indigenous"]) {
    const recipe = leveledBuildingRecipe(getBuildingDefinition(16), nation, detailed, 5);
    const rows = recipe.parts.map((part: any, index: number) => {
      const geometry = createRomanPartGeometry(part, detailed);
      const triangles = (geometry.index?.count ?? geometry.getAttribute("position").count) / 3;
      geometry.dispose();
      return { index, triangles, shape: part.shape, surface: part.surface, position: part.position, size: part.size };
    });
    rows.sort((a: any, b: any) => b.triangles - a.triangles);
    const keys = new Set([...Object.keys(ROMAN_SURFACE_COLOURS), ...Object.keys(NATION_SURFACES[nation] ?? {}),
      ...recipe.parts.map((part: any) => part.surface)]);
    const materials: Record<string, MeshStandardMaterial> = Object.fromEntries(
      [...keys].map(key => [key, new MeshStandardMaterial()]));
    const model = createRomanBuilding(getBuildingDefinition(16), materials, detailed, recipe, nation);
    const geometries=new Set<BufferGeometry>();
    model.root.traverse((object:any)=>{if(object.isMesh)geometries.add(object.geometry);});
    const actualVertices=[...geometries].reduce((sum,geometry)=>sum+geometry.getAttribute("position").count,0);
    console.log(JSON.stringify({ nation, quality: detailed ? "high" : "minimal", actualTriangles: model.triangles(false),
      actualVertices,
      rawTriangles: rows.reduce((sum: number, row: any) => sum + row.triangles, 0), largestParts: rows.slice(0, 6) }));
    model.dispose(); Object.values(materials).forEach(material => material.dispose());
  }
} finally { await server.close(); }
