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

const root = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
// `from "@/lib/db"`, `from "@/lib/history"`, `from "./db"`, `from "../lib/history"` …
const REACHES_DB = /from\s+["'](?:@\/lib\/|(?:\.\.?\/)+(?:lib\/)?)(?:db|history)["']/;
// The two deck modules that do reach the database: `from "@/lib/decks/data"`, `from "./gap"`, …
const REACHES_DECK_DB = /from\s+["'](?:@\/lib\/decks\/|(?:\.\.?\/)+(?:lib\/)?decks\/|\.\/)(?:data|gap)["']/;
// A type-only import is erased at compile time and never reaches the bundle, so it can't drag lib/db in
// (gap-math type-imports DeckLine from ./data). Drop those lines before the source-level match.
const withoutTypeImports = (src: string) => src.replace(/^\s*import\s+type\b[^;]*;?\s*$/gm, "");
// What the builder ("use client") imports, directly or through its own imports.
const BUILDER_MODULES = ["lib/decks/gap-math.ts", "lib/decks/validate.ts", "lib/decks/zone.ts", "lib/decks/identity.ts"];

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
  it("lib/history re-exports the range vocabulary unchanged", () => {
    expect(history.RANGES).toBe(ranges.RANGES);
    expect(history.RANGE_LABEL).toBe(ranges.RANGE_LABEL);
    expect(history.RANGE_CAPTION).toBe(ranges.RANGE_CAPTION);
    expect(history.parseRange).toBe(ranges.parseRange);
    expect(history.seriesStats).toBe(ranges.seriesStats);
  });
});
