/** Production HTML entries; every one is either the player game or an authenticated authoring surface. */
export const PRODUCTION_ENTRIES = {
  admin: "admin.html",
  editor: "editor.html",
  main: "index.html"
} as const;

/** Dev-server-only showcase/lab pages; they are not build inputs and are loopback-only. */
export const DEV_ONLY_PAGES = [
  "animal-showcase.html",
  "building-showcase.html",
  "campaign-ui-review.html",
  "editor-icons.html"
] as const;

/** True for a URL path that names a dev-only page (query/hash ignored). */
export const isDevOnlyPage = (url: string | undefined) => {
  if (!url) return false;
  const path = url.split(/[?#]/, 1)[0]!.replace(/^\/+/, "");
  return (DEV_ONLY_PAGES as readonly string[]).includes(path);
};

/** Socket peer check, not the spoofable Host header. */
export const isLoopbackPeer = (address: string | undefined) => {
  if (!address) return false;
  return address === "::1" || address === "::ffff:7f00:1" || address.startsWith("127.") ||
    address.startsWith("::ffff:127.");
};
