// @vitest-environment jsdom
// One set on /sets. Cards and sealed are reported apart, missing art gets a real stand-in rather
// than an empty box, and a set with no products at all stops being a destination.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SetCompletion } from "@/lib/catalog";
import SetPanel from "@/app/(app)/sets/SetPanel";

const set = (over: Partial<SetCompletion> = {}): SetCompletion => ({
  id: 9, slug: "prismatic-evolutions", name: "Prismatic Evolutions", code: "PRE",
  releaseDate: "2025-01-17T00:00:00Z",
  totalCards: 180, ownedCards: 40, totalSealed: 6, ownedSealed: 1,
  series: "Scarlet & Violet", seriesRank: 15,
  logoUrl: "https://images.pokemontcg.io/sv8pt5/logo.png", symbolUrl: null,
  ...over,
});

const panel = (over: Partial<SetCompletion> = {}, view: "grid" | "list" = "grid") =>
  render(<SetPanel set={set(over)} view={view} gameSlug="pokemon" />);

describe("SetPanel", () => {
  it("reports cards and sealed apart, never as one total", () => {
    panel();
    // "40 / 186" would claim six booster boxes are cards you are missing.
    expect(screen.getByText(/40 \/ 180/)).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 6 sealed/)).toBeInTheDocument();
  });

  it("says nothing about sealed for a set that ships none", () => {
    panel({ totalSealed: 0, ownedSealed: 0 });
    expect(screen.queryByText(/sealed/)).toBeNull();
    expect(screen.getByText(/40 \/ 180/)).toBeInTheDocument();
  });

  it("shows only the sealed count for a set with no numbered cards", () => {
    panel({ totalCards: 0, ownedCards: 0, totalSealed: 3, ownedSealed: 2 });
    expect(screen.getByText(/2 \/ 3 sealed/)).toBeInTheDocument();
    // No completion bar: there is nothing to complete.
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("links to the set by its slug", () => {
    panel();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/sets/pokemon/prismatic-evolutions");
  });

  it("falls back to the id when a set has no slug", () => {
    panel({ slug: null });
    expect(screen.getByRole("link")).toHaveAttribute("href", "/sets/pokemon/9");
  });

  it("renders an empty set but refuses to link to it", () => {
    panel({ totalCards: 0, ownedCards: 0, totalSealed: 0, ownedSealed: 0, name: "Blister Exclusives" });
    // Still on the page — it is part of the catalog — but a page for it would be a blank screen.
    expect(screen.getByText("Blister Exclusives")).toBeInTheDocument();
    expect(screen.getByText("Nothing listed")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("stands in for missing art with the set code, not an empty box", () => {
    const { container } = panel({ logoUrl: null, code: "OP07" });
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("OP07")).toBeInTheDocument();
  });

  it("uses the logo when there is one, and keeps it out of the accessibility tree", () => {
    const { container } = panel();
    const img = container.querySelector("img");
    // The link already carries the set's name; the logo repeating it is noise to a screen reader.
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("aria-hidden");
  });

  it("survives a set with neither art nor a code", () => {
    panel({ logoUrl: null, code: null });
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows the release day, not the ingested timestamp", () => {
    panel({}, "list");
    expect(screen.getByText(/PRE · 2025-01-17/)).toBeInTheDocument();
  });
});
