import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** Immutable content-addressed copies, including binary assets; indices may grow as packs load lazy imports. */
export const preserveGallerySourceVersions=(output:string,directory:string,files:Record<string,{sha256:string;bytes:number}>)=>{
  const folder=resolve(output,directory,"source-versions");mkdirSync(folder,{recursive:true});
  const indexPath=resolve(folder,"manifest.json");
  const index:Record<string,Record<string,{blob:string;bytes:number}>>=existsSync(indexPath)
    ?JSON.parse(readFileSync(indexPath,"utf8")):{};
  const versions:Record<string,string>={};
  for(const [path,expected] of Object.entries(files)) {
    const bytes=readFileSync(path),digest=createHash("sha256").update(bytes).digest("hex");
    assert.equal(digest,expected.sha256,`Dependency changed before immutable copy: ${path}`);
    const blob=`${directory}/source-versions/${digest}`,target=resolve(output,blob);
    if(existsSync(target))assert.equal(createHash("sha256").update(readFileSync(target)).digest("hex"),digest);
    else writeFileSync(target,bytes,{flag:"wx"});
    index[path]??={};index[path][digest]={blob,bytes:bytes.length};versions[path]=blob;
  }
  writeFileSync(indexPath,JSON.stringify(index,null,2));return versions;
};
