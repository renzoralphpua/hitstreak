// The icon standard is only a standard if something fails when it is broken. Icon.tsx documents the
// rules; these cases enforce the two that a reviewer cannot reliably catch by eye.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
/** LineChart draws data, not a glyph, so it is the one legitimate `<svg>` outside Icon.tsx. */
const ALLOWED = new Set(["Icon.tsx", "LineChart.tsx"]);

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("the icon standard", () => {
  it("is the only source of glyphs — no component hand-rolls an inline <svg>", () => {
    const offenders = [...tsxFiles(path.join(ROOT, "app")), ...tsxFiles(path.join(ROOT, "components"))]
      .filter((f) => !ALLOWED.has(path.basename(f)))
      .filter((f) => readFileSync(f, "utf8").includes("<svg"))
      .map((f) => path.relative(ROOT, f));
    // Nine hand-drawn glyphs across five files is how the pre-Phase-5 app drifted to two viewBoxes
    // and two stroke widths. Add the glyph to Icon.tsx instead; game marks get their own component.
    expect(offenders, `inline <svg> outside the Icon standard:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("pins the geometry every glyph is drawn with", () => {
    const src = readFileSync(path.join(ROOT, "components/ui/Icon.tsx"), "utf8");
    expect(src).toMatch(/viewBox="0 0 24 24"/);
    expect(src).toMatch(/strokeWidth=\{1\.8\}/);
    expect(src).toMatch(/stroke="currentColor"/);
    expect(src).toMatch(/fill="none"/);
  });

  it("keeps the size set closed", () => {
    const src = readFileSync(path.join(ROOT, "components/ui/Icon.tsx"), "utf8");
    expect(src).toMatch(/SIZES = \{ sm: 16, md: 20, lg: 24 \}/);
  });

  it("carries the note that game marks are a different category", () => {
    const src = readFileSync(path.join(ROOT, "components/ui/Icon.tsx"), "utf8");
    // Renzo intends to add per-game marks. They are filled, trademarked, and carry meaning rather
    // than decoration, so the doc block has to keep saying they do not belong in this map.
    expect(src).toMatch(/Game marks are NOT icons/);
  });
});
