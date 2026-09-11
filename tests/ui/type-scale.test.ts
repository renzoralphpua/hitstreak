// The ramp is only a ramp if something fails when a fourteenth size reappears. Before this pass the
// app carried 81 arbitrary `text-[Npx]` against 66 Tailwind named sizes, with 12px and 13px both
// doing "secondary text" across 107 uses and no rule deciding which. These cases keep that shut.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}
const sources = () =>
  [...tsxFiles(path.join(ROOT, "app")), ...tsxFiles(path.join(ROOT, "components"))].map((f) => ({
    file: path.relative(ROOT, f),
    body: readFileSync(f, "utf8"),
  }));

/** `text-[13px]`, `text-[15px]`, … — a size invented at the call site. */
const ARBITRARY = /text-\[\d+px\]/g;
/** Tailwind's own scale. Its names say how big, not what for, and its `base` is 16px, not ours. */
const TAILWIND = /(?<![\w-])text-(xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/g;

describe("the type scale", () => {
  it("has no arbitrary pixel sizes left at any call site", () => {
    const offenders = sources()
      .flatMap(({ file, body }) => (body.match(ARBITRARY) ?? []).map((m) => `${file}: ${m}`));
    expect(offenders, `arbitrary type sizes:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("uses the app's names, never Tailwind's generic scale", () => {
    // `text-base` IS one of ours, redefined to 14px in globals.css — the regex catches the name and
    // this filter lets it through, because the whole point is that the app owns the meaning.
    const offenders = sources().flatMap(({ file, body }) =>
      (body.match(TAILWIND) ?? []).filter((m) => m !== "text-base").map((m) => `${file}: ${m}`)
    );
    expect(offenders, `Tailwind type sizes:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("keeps 13px out of the stylesheet as well as out of the components", () => {
    const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
    expect(css).not.toMatch(/--text-[a-z]+:\s*13px/);
  });
});
