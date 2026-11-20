import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { preserveGallerySourceVersions } from "../tools/bench/building-gallery-source-versions";

it("preserves exact accepted source bytes across later edits without replacing the old version",()=>{
  const folder=mkdtempSync(resolve(tmpdir(),"gallery-versions-")),source=resolve(folder,"sample.ts");
  const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
  try {
    writeFileSync(source,"first");
    const first=preserveGallerySourceVersions(folder,"revisions/test",{[source]:{sha256:hash("first"),bytes:5}});
    writeFileSync(source,"second");
    expect(()=>preserveGallerySourceVersions(folder,"revisions/test",{[source]:{sha256:hash("first"),bytes:5}}))
      .toThrow("Dependency changed");
    const second=preserveGallerySourceVersions(folder,"revisions/test",{[source]:{sha256:hash("second"),bytes:6}});
    expect(readFileSync(resolve(folder,first[source]!),"utf8")).toBe("first");
    expect(readFileSync(resolve(folder,second[source]!),"utf8")).toBe("second");
    const index=JSON.parse(readFileSync(resolve(folder,"revisions/test/source-versions/manifest.json"),"utf8"));
    expect(Object.keys(index[source])).toHaveLength(2);
  } finally {rmSync(folder,{recursive:true,force:true});}
});
