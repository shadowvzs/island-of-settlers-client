import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "catapult-rock-2026-11-02");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const errors: string[] = [], reports: unknown[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 720, height: 600 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/catapult-rock-review.html", route => route.fulfill({ contentType: "text/html",
    body: `<body style="margin:0"><script type="module">
      import * as THREE from '/node_modules/three/build/three.module.js';
      import {GLTFExporter} from '/node_modules/three/examples/jsm/exporters/GLTFExporter.js';
      import {GLTFLoader} from '/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
      import {createCatapultRockGeometry,createCatapultRockMaterial,disposeCatapultRockMaterial}
        from '/src/renderers/three/buildings/catapult-rock-geometry.ts';
      const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(720,600);
      renderer.setPixelRatio(1);renderer.shadowMap.enabled=true;
      renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.append(renderer.domElement);
      const scene=new THREE.Scene();scene.background=new THREE.Color('#dedbd1');
      const camera=new THREE.PerspectiveCamera(32,720/600,.1,20);
      camera.position.set(1.65,1.35,1.8);camera.lookAt(0,.48,0);
      scene.add(new THREE.HemisphereLight(0xe8f0ff,0x6d6654,2.1));
      const sun=new THREE.DirectionalLight(0xffefdb,3);sun.position.set(-2,4,3);
      sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);scene.add(sun);
      const ground=new THREE.Mesh(new THREE.PlaneGeometry(10,10),
        new THREE.MeshStandardMaterial({color:'#b6b19f',roughness:1}));
      ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
      let rock;
      window.reviewRock=async(detailed)=>{
        if(rock){scene.remove(rock);rock.geometry.dispose();disposeCatapultRockMaterial(rock.material);}
        rock=new THREE.Mesh(createCatapultRockGeometry(detailed),createCatapultRockMaterial(detailed));
        rock.position.y=.5;rock.castShadow=true;rock.receiveShadow=true;scene.add(rock);
        renderer.render(scene,camera);
        const bytes=await new GLTFExporter().parseAsync(rock,{binary:true});
        const loaded=await new GLTFLoader().parseAsync(bytes,'');
        let meshes=0;loaded.scene.traverse(object=>{
          if(!object.isMesh)return;meshes++;
          if(!object.material.map || (!!object.material.normalMap)!==detailed)
            throw new Error('Rock GLB lost its mineral material');
          object.geometry.dispose();object.material.map.dispose();
          object.material.normalMap?.dispose();object.material.dispose();
        });
        renderer.render(scene,camera);
        return {detailed,triangles:rock.geometry.attributes.position.count/3,
          roughness:rock.material.roughness,normalMap:!!rock.material.normalMap,
          glbBytes:bytes.byteLength,roundTripMeshes:meshes};
      };
      window.ready=true;
    </script>` }));
  await page.goto(`${url}catapult-rock-review.html`);
  await page.waitForFunction(() => (window as any).ready);
  for (const detailed of [true, false]) {
    reports.push(await page.evaluate(detailed => (window as any).reviewRock(detailed), detailed));
    const quality = detailed ? "high" : "minimal";
    await page.screenshot({ path: resolve(output, `${quality}.png`) });
  }
  if (errors.length) throw new Error(errors.join("\n"));
  writeFileSync(resolve(output, "review.json"), JSON.stringify({ errors, reports }, null, 2));
} finally { await browser.close(); await server.close(); }
