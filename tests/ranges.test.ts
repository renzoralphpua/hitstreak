// lib/ranges.ts exists so the chart primitives can be reached from "use client" modules (through
// components/ui/index.ts) without dragging lib/db → @libsql/client into the client module graph.
// Source-level guards: they fail the moment a primitive is pointed back at lib/history (which imports
// lib/db) or lib/ranges grows a db import. The pure helpers themselves are covered in history.test.ts.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as ranges from "@/lib/ranges";
import * as history from "@/lib/history";
import * as gap from "@/lib/decks/gap";
import * as gapMath from "@/lib/decks/gap-math";
import * as resolve from "@/lib/decks/resolve";
import * as decklist from "@/lib/decks/decklist";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
// `from "@/lib/db"`, `from "@/lib/history"`, `from "./db"`, `from "../lib/history"` …
const REACHES_DB = /from\s+["'](?:@\/lib\/|(?:\.\.?\/)+(?:lib\/)?)(?:db|history)["']/;
// The two deck modules that do reach the database: `from "@/lib/decks/data"`, `from "./gap"`, …
const REACHES_DECK_DB = /from\s+["'](?:@\/lib\/decks\/|(?:\.\.?\/)+(?:lib\/)?decks\/|\.\/)(?:data|gap|resolve)["']/;
// A type-only import is erased at compile time and never reaches the bundle, so it can't drag lib/db in
// (gap-math type-imports DeckLine from ./data). Drop those lines before the source-level match.
const withoutTypeImports = (src: string) => src.replace(/^\s*import\s+type\b[^;]*;?\s*$/gm, "");
// What the builder ("use client") imports, directly or through its own imports, plus lib/decks/decklist
// which the admin curation form imports for mergeResolved.
const BUILDER_MODULES = ["lib/decks/gap-math.ts", "lib/decks/validate.ts", "lib/decks/zone.ts", "lib/decks/identity.ts", "lib/decks/decklist.ts"];

describe("db-free client boundary", () => {
  it("lib/ranges.ts imports neither lib/db nor lib/history", () => {
    expect(read("lib/ranges.ts")).not.toMatch(REACHES_DB);
  });
  it("nothing under components/ui imports lib/db or lib/history", () => {
    const files = readdirSync(path.join(root, "components/ui")).filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(read(`components/ui/${f}`), `components/ui/${f}`).not.toMatch(REACHES_DB);
  });
  it("the deck modules the builder imports reach neither lib/db nor the db-backed deck modules", () => {
    for (const f of BUILDER_MODULES) {
      const src = withoutTypeImports(read(f));
      expect(src, f).not.toMatch(REACHES_DB);
      expect(src, f).not.toMatch(REACHES_DECK_DB);
    }
  });
  it("lib/decks/gap re-exports the gap arithmetic unchanged", () => {
    expect(gap.analyzeGap).toBe(gapMath.analyzeGap);
  });
  it("lib/decks/resolve re-exports the text-only decklist helpers unchanged", () => {
    expect(resolve.parseDecklist).toBe(decklist.parseDecklist);
    expect(resolve.formatDecklist).toBe(decklist.formatDecklist);
    expect(resolve.mergeResolved).toBe(decklist.mergeResolved);
  });
  // A `.mts` script run by tsx uses Node's strict-ESM path, which does NOT see `export *` re-exports
  // (verified: importing mergeResolved from lib/decks/resolve dies at link time, which is how the Task 8
  // split silently broke scripts/import-deck.mts). Scripts must name the leaf module. Product code and the
  // bundler are unaffected, so only scripts/ is guarded.
  it("scripts/*.mts import the pure decklist helpers from the leaf module, not through a re-export", () => {
    const scripts = readdirSync(path.join(root, "scripts")).filter((f) => f.endsWith(".mts"));
    expect(scripts.length).toBeGreaterThan(0);
    for (const f of scripts) {
      const src = withoutTypeImports(read(`scripts/${f}`));
      const fromResolve = src.match(/import\s*\{([^}]*)\}\s*from\s+["'][^"']*decks\/resolve["']/)?.[1] ?? "";
      for (const name of ["parseDecklist", "formatDecklist", "mergeResolved"]) {
        expect(fromResolve, `scripts/${f} imports ${name} from lib/decks/resolve`).not.toContain(name);
      }
    }
  });

  it("lib/history re-exports the range vocabulary unchanged", () => {
    expect(history.RANGES).toBe(ranges.RANGES);
    expect(history.RANGE_LABEL).toBe(ranges.RANGE_LABEL);
    expect(history.RANGE_CAPTION).toBe(ranges.RANGE_CAPTION);
    expect(history.parseRange).toBe(ranges.parseRange);
    expect(history.seriesStats).toBe(ranges.seriesStats);
  });
});
