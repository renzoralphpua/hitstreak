/** Only same-origin absolute paths survive; everything else falls back. Guards against
 *  open redirects incl. `//evil`, `/\evil`, and control-character tricks (`/\t/evil`). */
export function safeNext(v: unknown, fallback = "/portfolios"): string {
  if (typeof v !== "string" || v.length === 0 || v.length > 2048) return fallback;
  // \p{Cc} = Unicode "Control" (C0 + DEL + C1); the URL parser would otherwise strip
  // tab/newline and turn "/\t/evil" into "//evil".
  const cleaned = v.replace(/\p{Cc}/gu, "");
  if (!cleaned.startsWith("/")) return fallback;
  let u: URL;
  try {
    u = new URL(cleaned, "http://x.invalid");
  } catch {
    return fallback;
  }
  if (u.origin !== "http://x.invalid") return fallback;
  if (!u.pathname.startsWith("/")) return fallback;
  return u.pathname + u.search + u.hash;
}
