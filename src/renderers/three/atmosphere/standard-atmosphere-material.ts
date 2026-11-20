import {
  AdditiveBlending,
  type IUniform,
  Material,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer
} from "three";

import { isColorContractRenderer } from "../color/color-output-control";
import {
  applyStandardAtmosphereShader,
  isStandardAtmosphereMaterial,
  STANDARD_ATMOSPHERE_CACHE_KEY_SUFFIX
} from "./standard-atmosphere-shader";

type BeforeCompile = Material["onBeforeCompile"];
type ProgramCacheKey = Material["customProgramCacheKey"];

const ALL_RENDERERS = Symbol("all-standard-atmosphere-renderers");
type ScopeOwner = WebGLRenderer | typeof ALL_RENDERERS;

interface MaterialScope {
  readonly onDispose: () => void;
  readonly uniforms: Record<string, IUniform>;
}

interface MaterialRecord {
  cacheKey: ProgramCacheKey;
  hook: BeforeCompile;
  onMaterialDispose: () => void;
  originalCacheKey: ProgramCacheKey;
  originalHook: BeforeCompile;
  readonly scopes: Map<ScopeOwner, MaterialScope>;
  version: number;
}

const records = new WeakMap<Material, MaterialRecord>();

/** Three only re-runs program selection after the material version changes. */
const invalidateProgram = (material: Material): void => {
  material.needsUpdate = true;
};

const disposeRecord = (material: Material, record: MaterialRecord): void => {
  material.removeEventListener("dispose", record.onMaterialDispose);
  if (material.onBeforeCompile === record.hook) {
    material.onBeforeCompile = record.originalHook;
  }
  if (material.customProgramCacheKey === record.cacheKey) {
    material.customProgramCacheKey = record.originalCacheKey;
  }
  records.delete(material);
};

const releaseScope = (
  material: Material,
  record: MaterialRecord,
  owner: ScopeOwner
): void => {
  const scope = record.scopes.get(owner);
  if (!scope) return;
  material.removeEventListener("dispose", scope.onDispose);
  record.scopes.delete(owner);
  record.version++;
  invalidateProgram(material);
  if (record.scopes.size === 0) disposeRecord(material, record);
};

const releaseAllScopes = (material: Material, record: MaterialRecord): void => {
  for (const owner of record.scopes.keys()) {
    releaseScope(material, record, owner);
  }
  if (records.get(material) === record) disposeRecord(material, record);
};

const createRecord = (material: Material): MaterialRecord => {
  let record!: MaterialRecord;
  const hook: BeforeCompile = function (
    this: Material,
    shader: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer
  ) {
    record.originalHook.call(this, shader, renderer);
    const scope = record.scopes.get(renderer) ?? record.scopes.get(ALL_RENDERERS);
    if (!scope) return;
    applyStandardAtmosphereShader(material, scope.uniforms, shader, isColorContractRenderer(renderer));
  };
  const cacheKey: ProgramCacheKey = function (this: Material) {
    const original = record.originalCacheKey === Material.prototype.customProgramCacheKey
      ? record.originalHook.toString()
      : record.originalCacheKey.call(this);
    // Scope changes alter this shader only for some renderers, so the key must change as well.
    return `${original}:${STANDARD_ATMOSPHERE_CACHE_KEY_SUFFIX}:${record.version}${material.blending === AdditiveBlending ? ":additive" : ""}`;
  };
  const onMaterialDispose = () => releaseAllScopes(material, record);
  record = {
    cacheKey,
    hook,
    onMaterialDispose,
    originalCacheKey: material.customProgramCacheKey,
    originalHook: material.onBeforeCompile,
    scopes: new Map(),
    version: 0
  };
  material.onBeforeCompile = hook;
  material.customProgramCacheKey = cacheKey;
  material.addEventListener("dispose", onMaterialDispose);
  records.set(material, record);
  return record;
};

/** Re-chain if a factory replaced either hook after the first binding pass. */
const synchronizeRecord = (material: Material, record: MaterialRecord): void => {
  let changed = false;
  if (material.onBeforeCompile !== record.hook) {
    record.originalHook = material.onBeforeCompile;
    material.onBeforeCompile = record.hook;
    changed = true;
  }
  if (material.customProgramCacheKey !== record.cacheKey) {
    record.originalCacheKey = material.customProgramCacheKey;
    material.customProgramCacheKey = record.cacheKey;
    changed = true;
  }
  if (changed) invalidateProgram(material);
};

/**
 * Installs one scoped atmosphere tail on a built-in world material. Supplying the renderer makes
 * the injection exclusive to it; repeated installation for that renderer is a no-op.
 */
export const installStandardAtmosphere = (
  material: Material,
  uniforms: Record<string, IUniform>,
  renderer?: WebGLRenderer
): void => {
  if (!isStandardAtmosphereMaterial(material)) return;
  const record = records.get(material) ?? createRecord(material);
  synchronizeRecord(material, record);
  const owner: ScopeOwner = renderer ?? ALL_RENDERERS;
  if (record.scopes.has(owner)) return;
  const scope: MaterialScope = {
    onDispose: () => releaseScope(material, record, owner),
    uniforms
  };
  record.scopes.set(owner, scope);
  record.version++;
  invalidateProgram(material);
  material.addEventListener("dispose", scope.onDispose);
};

/** Removes one renderer's scope, or every scope when no renderer is supplied. */
export const uninstallStandardAtmosphere = (
  material: Material,
  renderer?: WebGLRenderer
): void => {
  const record = records.get(material);
  if (!record) return;
  if (renderer) {
    releaseScope(material, record, renderer);
    return;
  }
  releaseAllScopes(material, record);
};
