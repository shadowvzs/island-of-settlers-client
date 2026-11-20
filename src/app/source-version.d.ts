/** Hash of the source and asset trees (sourceVersionPlugin, vite.config.ts): the cache version. */
declare module "virtual:source-version" {
  export const SOURCE_VERSION: string;
  export const SOURCE_VERSIONS: Record<string, string>;
}
