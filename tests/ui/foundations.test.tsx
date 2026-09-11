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
import TopNav from "@/components/ui/TopNav";
import PriceDelta from "@/components/ui/PriceDelta";
import Input from "@/components/ui/Input";
import { vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/binders" }));

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

  it("defines the whole ramp, and nothing outside it", () => {
    // Nine sizes. 12px won the caption slot over 13px because the artboards use it 218 times
    // against 13's 90 — the design always preferred it; the code drifted.
    const RAMP = [
      ["micro", "11px"], ["caption", "12px"], ["base", "14px"], ["stat", "18px"],
      ["title", "22px"], ["wordmark", "24px"], ["section", "26px"], ["price", "32px"], ["hero", "56px"],
    ] as const;
    for (const [name, px] of RAMP) {
      expect(css, `--text-${name}`).toContain(`--text-${name}: ${px}`);
    }
    expect(css).toContain("--tracking-label:");
    // 13px is retired: it split "secondary text" with 12px across 107 uses and no rule.
    expect(css).not.toMatch(/--text-[a-z]+:\s*13px/);
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

  it("the desktop header is pinned, so Save and draft status never scroll away in the builder", () => {
    render(<TopNav />);
    const header = screen.getByRole("banner");
    expect(header.className).toMatch(/sticky/);
    expect(header.className).toMatch(/top-0/);
    // A transparent sticky header lets content slide visibly underneath it.
    expect(header.className).toMatch(/bg-ground/);
  });

  it("a zero delta is dim text, and the em dash is left to mean unknown", () => {
    const { rerender, container } = render(<PriceDelta amount={0} ratio={0} />);
    expect(container.textContent).toContain("$0.00");
    // The zero case used to render "— $0.00", so one mark meant both "no data" and "no movement".
    expect(container.textContent).not.toContain("—");
    expect(container.textContent).not.toMatch(/[▲▼]/);

    rerender(<PriceDelta amount={null} />);
    expect(container.textContent).toBe("—");
  });

  it("keeps a gain green and a loss terracotta, each with its own arrow", () => {
    const { rerender, container } = render(<PriceDelta amount={12.5} />);
    expect(container.firstElementChild).toHaveClass("text-gain");
    expect(container.textContent).toContain("▲");
    rerender(<PriceDelta amount={-12.5} />);
    expect(container.firstElementChild).toHaveClass("text-accent");
    expect(container.textContent).toContain("▼");
  });

  it("Input no longer strips the browser's focus ring", () => {
    render(<Input aria-label="Name" />);
    expect(screen.getByLabelText("Name").className).not.toMatch(/outline-none/);
  });
});
