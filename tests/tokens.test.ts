import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("app/globals.css", "utf8");
const TOKENS = ["ground", "surface", "hairline", "hairline-soft", "ink", "muted", "dim", "accent", "gain", "chip", "chip-ink"];

describe("design tokens", () => {
  it("defines every color token for light (:root) and dark ([data-theme=dark])", () => {
    const light = css.slice(css.indexOf(":root"), css.indexOf("[data-theme=\"dark\"]"));
    const dark = css.slice(css.indexOf("[data-theme=\"dark\"]"));
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
