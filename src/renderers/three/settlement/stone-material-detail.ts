import type { MeshStandardMaterial } from "three";

import type { ColonyStone } from "../../../shared/world/colony-resource-tiers";

/** UV-bound mineral structure: static shader work, one existing material and draw pass. */
export const applyStoneMaterialDetail = (material: MeshStandardMaterial, family: string, detailed: boolean) => {
  const details: Record<string, string> = {
    marble: `
      float vein = pow(.5 + .5*sin(vMapUv.x*22.0 + vMapUv.y*9.0 + sin(vMapUv.y*15.0)*1.8), 24.0);
      diffuseColor.rgb *= mix(vec3(1.0), vec3(.70,.77,.84), vein*.19);`,
    limestone: `
      float bedding = .5+.5*sin(vMapUv.y*38.0 + sin(vMapUv.x*8.0)*.8);
      float bed = smoothstep(.78,.98,bedding);
      diffuseColor.rgb *= mix(vec3(1.0),vec3(.80,.72,.58),bed*.25);
      diffuseColor.rgb *= .96+.04*sin(vMapUv.x*17.0+vMapUv.y*11.0);`,
    basalt: `
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuse, .52);
      float fracture = pow(.5+.5*sin(vMapUv.x*19.0+vMapUv.y*13.0+sin(vMapUv.y*11.0)),32.0);
      diffuseColor.rgb *= mix(vec3(.84,.89,.96),vec3(1.12,1.14,1.18),fracture*.38);
      diffuseColor.rgb *= .94+.06*sin(vMapUv.x*9.0-vMapUv.y*7.0);`,
    granite: `
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuse, .88);
      vec2 grainUv = vMapUv * ${detailed ? "31.0" : "23.0"};
      vec2 grainCell = floor(grainUv);
      float mineral = fract(sin(dot(grainCell,vec2(127.1,311.7)))*43758.5453);
      vec2 grainLocal = fract(grainUv)-.5;
      float grainMask = 1.0-smoothstep(.10,.42,length(grainLocal));
      float mica = step(.76,mineral)*grainMask;
      float feldspar = (1.0-step(.28,mineral))*grainMask;
      diffuseColor.rgb *= mix(vec3(1.0),vec3(.54,.56,.59),mica*.65);
      diffuseColor.rgb *= mix(vec3(1.0),vec3(1.12,.91,.84),feldspar*.5);
      diffuseColor.rgb *= .97+.03*sin(vMapUv.x*13.0+vMapUv.y*8.0);`
  };
  const detail = details[family]; if (!detail) return;
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>\n${detail}`);
  };
  material.customProgramCacheKey = () => `stone-mineral-v4:${family}:${detailed}`;
};

/**
 * World-space mineral structure for the deposit boulder shader, appended after its flat material
 * tint (which keeps the rock's luminance detail but drops its texture chroma). Each family gets
 * the close-up identity of its material: cool veins in marble, pale and dark mineral speckles in
 * granite, warm horizontal bedding in limestone and faint blue-grey fractures in basalt. The
 * patterns fade out with the pixel footprint, so they add character up close without shimmering
 * at gameplay distance. Needs `vWorld` and the shared noise functions; Minimal (`ROCK_LITE`)
 * skips them and keeps the tinted rock detail.
 */
export const STONE_DEPOSIT_DETAIL_GLSL: Readonly<Record<ColonyStone, string>> = {
  basalt: `
#ifndef ROCK_LITE
  float depositFade = 1.0 - smoothstep(0.02, 0.085, length(fwidth(vWorld)));
  float basaltCrack = pow(.5 + .5*sin(vWorld.x*8.0 + vWorld.z*6.3 + sin(vWorld.y*5.1)), 28.0);
  rock.albedo = mix(rock.albedo, rock.albedo*vec3(.90,.95,1.06), basaltCrack*.35*depositFade);
#endif`,
  granite: `
#ifndef ROCK_LITE
  float depositFade = 1.0 - smoothstep(0.012, 0.05, length(fwidth(vWorld)));
  vec4 grains = valueNoise4(vWorld.xz*17.0 + vWorld.y*11.0);
  float mica = smoothstep(.72, .92, grains.r);
  float feldspar = smoothstep(.76, .95, grains.g);
  rock.albedo = mix(rock.albedo, rock.albedo*vec3(.58,.63,.72), mica*.55*depositFade);
  rock.albedo = mix(rock.albedo, rock.albedo*vec3(1.16,.95,.90), feldspar*.4*depositFade);
  rock.albedo *= 1.0 + (valueNoise(vWorld.xz*3.7 + vWorld.y*2.9) - .5)*.09*depositFade;
#endif`,
  limestone: `
#ifndef ROCK_LITE
  float depositFade = 1.0 - smoothstep(0.02, 0.085, length(fwidth(vWorld)));
  float beddingNoise = valueNoise(vWorld.xz*2.1 + vWorld.y*1.5);
  float bedding = .5 + .5*sin(vWorld.y*30.0 + beddingNoise*3.2);
  float beds = smoothstep(.72, .97, bedding);
  rock.albedo *= mix(vec3(1.0), vec3(.78,.68,.50), beds*.22*depositFade);
  rock.albedo *= 1.0 + (valueNoise(vWorld.xz*9.0 + vWorld.y*6.0) - .5)*.07*depositFade;
#endif`,
  marble: `
#ifndef ROCK_LITE
  float depositFade = 1.0 - smoothstep(0.02, 0.08, length(fwidth(vWorld)));
  float marbleBand = sin(vWorld.x*4.1 + vWorld.z*3.3 + sin(vWorld.y*3.1)*1.4);
  float marbleThread = sin(vWorld.x*9.7 - vWorld.z*7.3 + vWorld.y*3.9);
  float marbleVein = smoothstep(.90, .995, marbleBand*.65 + marbleThread*.35);
  rock.albedo = mix(rock.albedo, rock.albedo*vec3(.72,.78,.87), marbleVein*.6*depositFade);
  rock.albedo *= 1.0 + (valueNoise(vWorld.xz*5.0 + vWorld.y*3.5) - .5)*.06*depositFade;
#endif`
};
