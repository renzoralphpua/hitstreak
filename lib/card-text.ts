// Card attributes arrive from TCGplayer as fragments of HTML, not as text. Around 29,000 cards in
// the catalog carry markup in `CardText`, `Attack 1` and `Attack 2` — <br>, <strong>, <em>, and the
// occasional <a> — and rendering them as a string puts the tags on screen.
//
// The fix is to strip, never to render. This is third-party content the ingest has no control over,
// so it must never reach `dangerouslySetInnerHTML`: one <img onerror> or <script> in an upstream
// description would be an XSS hole in every card page. Formatting is not worth that, and the only
// formatting actually used is a line break.

// Whitespace either side is eaten with the tag: upstream text is full of a break followed by a real
// newline, and leaving that newline behind would double every single break. Consecutive tags still
// match separately, so a genuine paragraph gap survives.
const BLOCK_BREAK = /\s*<\s*(?:br|\/p|\/div|\/li)\s*\/?\s*>\s*/gi;
const TAG = /<[^>]*>/g;

/** The named entities that survive a strip; numeric ones are handled by code point. */
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // Control characters decoded out of upstream text would be invisible junk at best.
      return Number.isFinite(code) && code >= 32 ? String.fromCodePoint(code) : "";
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

/**
 * An HTML fragment as plain text, with line breaks preserved.
 *
 * Break-ish tags become newlines so an attack cost and its effect do not run together; everything
 * else is removed. Decoding happens AFTER stripping, so an escaped `&lt;script&gt;` in the source
 * becomes visible text rather than a tag — decoding first would reintroduce the markup this exists
 * to remove.
 */
export function toPlainText(value: unknown): string {
  if (value == null) return "";
  const stripped = String(value).replace(BLOCK_BREAK, "\n").replace(TAG, "");
  return decodeEntities(stripped)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when the value has anything left to show once the markup is gone. */
export const hasText = (value: unknown): boolean => toPlainText(value).length > 0;
