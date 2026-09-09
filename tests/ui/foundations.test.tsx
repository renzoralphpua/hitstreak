// @vitest-environment jsdom
// Phase 5 foundations: the token layer and the seven bugs the UI audit found. Each case pins the
// FIX, so a later refactor that reintroduces the bug fails here rather than in someone's browser.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import ProgressBar from "@/components/ui/ProgressBar";
import SearchField from "@/components/ui/SearchField";
import BottomTabBar from "@/components/ui/BottomTabBar";
import Input from "@/components/ui/Input";
import { vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/portfolios" }));

const css = readFileSync(path.resolve(import.meta.dirname, "../../app/globals.css"), "utf8");
/** The `{ … }` body of the first rule whose selector line starts with `selector`. */
function ruleBody(selector: string): string {
  const lines = css.split("\n");
  const start = lines.findIndex((l) => l.trimStart().startsWith(selector) && l.includes("{"));
  if (start === -1) throw new Error(`no rule starting with ${selector}`);
  const end = lines.findIndex((l, i) => i > start && l.trim() === "}");
  return lines.slice(start + 1, end).join("\n");
}

describe("Phase 5 tokens", () => {
  const NEW = ["chip-ink-muted", "hairline-strong", "accent-hover", "focus"];

  it("defines every new colour token in both themes", () => {
    const light = ruleBody(":root");
    const dark = ruleBody('[data-theme="dark"]');
    for (const t of NEW) {
      expect(light, `light --${t}`).toMatch(new RegExp(`--${t}:\\s*#`));
      expect(dark, `dark --${t}`).toMatch(new RegExp(`--${t}:\\s*#`));
    }
  });

  it("exposes the new colour tokens to Tailwind", () => {
    for (const t of NEW) expect(css).toMatch(new RegExp(`--color-${t}:\\s*var\\(--${t}\\)`));
  });

  it("names the small type ramp instead of leaving it as arbitrary values", () => {
    expect(css).toMatch(/--text-caption:\s*13px/);
    expect(css).toMatch(/--text-micro:\s*11px/);
    expect(css).toMatch(/--tracking-label:/);
  });

  it("has one focus-visible ring for the whole app, and a link hover colour", () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\)/);
    expect(css).toMatch(/a:hover\s*\{\s*color:\s*var\(--accent-hover\)/);
  });

  it("honours prefers-reduced-motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("keeps the art radius and shadow as tokens rather than arbitrary values", () => {
    expect(css).toMatch(/--radius-art:\s*16px/);
    expect(css).toMatch(/--shadow-art:\s*var\(--art-shadow\)/);
  });
});

describe("Phase 5 bug fixes", () => {
  it("the muted progress bar is visible against its own track", () => {
    // --hairline (#e3dccf) on --hairline-soft (#ece5d8) was 1.06:1 — a blank bar.
    render(<ProgressBar value={0} label="Completion" tone="muted" />);
    const fill = screen.getByRole("progressbar").firstElementChild;
    expect(fill).toHaveClass("bg-hairline-strong");
    expect(fill).not.toHaveClass("bg-hairline");
  });

  it("the phone tab bar is pinned, not scrolled away with the page", () => {
    render(<BottomTabBar />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.className).toMatch(/sticky/);
    expect(nav.className).toMatch(/bottom-0/);
  });

  it("SearchField meets the 44px phone target and shows focus on its whole pill", () => {
    const { container } = render(<SearchField value="" onChange={() => {}} />);
    const label = container.querySelector("label")!;
    expect(label.className).toMatch(/min-h-11/);
    expect(label.className).toMatch(/md:min-h-10/);
    expect(label.className).toMatch(/focus-within:outline-focus/);
  });

  it("Input no longer strips the browser's focus ring", () => {
    render(<Input aria-label="Name" />);
    expect(screen.getByLabelText("Name").className).not.toMatch(/outline-none/);
  });
});
