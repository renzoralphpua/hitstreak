/** Only same-origin absolute paths survive; everything else falls back. Guards against
 *  open redirects incl. `//evil`, `/\evil`, and control-character tricks (`/\t/evil`). */
export function safeNext(v: unknown, fallback = "/portfolios"): string {
  if (typeof v !== "string" || v.length === 0 || v.length > 2048) return fallback;
  const CONTROL_CHARS = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "]", "g");
  const cleaned = v.replace(CONTROL_CHARS, "");
  if (!cleaned.startsWith("/")) return fallback;
  let u: URL;
  try { u = new URL(cleaned, "http://x.invalid"); } catch { return fallback; }
  if (u.origin !== "http://x.invalid") return fallback;
  if (!u.pathname.startsWith("/")) return fallback;
  return u.pathname + u.search + u.hash;
}
