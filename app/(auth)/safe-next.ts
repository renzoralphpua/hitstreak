/** Open-redirect guard: only same-origin absolute paths ("/x"), never "//evil.com". */
export function safeNext(next: string | string[] | undefined, fallback = "/portfolios"): string {
  const v = Array.isArray(next) ? next[0] : next;
  if (!v || !v.startsWith("/") || v.startsWith("//")) return fallback;
  return v;
}
