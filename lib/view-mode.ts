// Grid or list, carried in the URL rather than localStorage so the view is server-rendered on the
// first paint and survives being shared or bookmarked — the same reason `?range=` and `?p=` live
// there. Grid is the default: a binder is a thing you look at.
export const VIEW_MODES = ["grid", "list"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/** Anything that is not an exact mode — absent, misspelt, or a repeated query key — is `grid`. */
export function parseView(raw: string | string[] | undefined): ViewMode {
  return raw === "list" ? "list" : "grid";
}
