import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("app/globals.css", "utf8");
const TOKENS = ["ground", "surface", "hairline", "hairline-soft", "ink", "muted", "dim", "accent", "gain", "chip", "chip-ink"];

/** The `{ … }` body of the first rule whose selector line starts with `selector` (ignores comments). */
function ruleBody(selector: string): string {
  const lines = css.split("\n");
  const start = lines.findIndex((l) => l.trimStart().startsWith(selector) && l.includes("{"));
  if (start === -1) throw new Error(`no rule starting with ${selector}`);
  const end = lines.findIndex((l, i) => i > start && l.trim() === "}");
  return lines.slice(start + 1, end).join("\n");
}

describe("design tokens", () => {
  it("defines every color token for light (:root) and dark ([data-theme=dark])", () => {
    const light = ruleBody(":root");
    const dark = ruleBody('[data-theme="dark"]');
    for (const t of TOKENS) {
      expect(light, `light --${t}`).toMatch(new RegExp(`--${t}:\\s*#`));
      expect(dark, `dark --${t}`).toMatch(new RegExp(`--${t}:\\s*#`));
    }
  });

  it("exposes tokens to Tailwind via @theme inline", () => {
    expect(css).toMatch(/@theme inline/);
    for (const t of TOKENS) expect(css).toMatch(new RegExp(`--color-${t}:\\s*var\\(--${t}\\)`));
    expect(css).toMatch(/--font-display:\s*var\(--font-dm-serif\)/);
    expect(css).toMatch(/--font-body:\s*var\(--font-dm-sans\)/);
  });
});
