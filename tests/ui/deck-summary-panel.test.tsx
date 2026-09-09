// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DeckSummaryPanel from "@/app/(app)/decks/DeckSummaryPanel";
import type { DeckSummary } from "@/lib/decks/data";
import type { GapAnalysis } from "@/lib/decks/gap";

const deck = (over: Partial<DeckSummary> = {}): DeckSummary => ({
  id: 7, gameSlug: "pokemon", gameName: "Pokémon", name: "Charizard ex / Pidgeot", archetype: "Charizard ex", tier: 1,
  format: "standard", sourceNote: null, isMeta: true, isDraft: false, updatedAt: "2026-09-08", cardCount: 60, ...over,
});
// The panel only reads the totals; `lines` stays empty (no DB, no identity keys).
const gap = (over: Partial<GapAnalysis> = {}): GapAnalysis => ({
  lines: [], total: 60, owned: 51, missing: 9, missingCost: 86.4, unpricedMissing: 0, ...over,
});

describe("DeckSummaryPanel", () => {
  it("links to the deck and shows name, tier, owned count, cost to complete and the completion bar", () => {
    render(<DeckSummaryPanel deck={deck()} gap={gap()} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/decks/7");
    expect(screen.getByText("Charizard ex / Pidgeot")).toBeInTheDocument();
    expect(screen.getByText("Tier 1")).toBeInTheDocument();
    expect(screen.getByText("Charizard ex")).toBeInTheDocument(); // archetype differs from the name
    expect(screen.getByText("51 / 60").parentElement).toHaveTextContent("You own 51 / 60");
    expect(screen.getByText("$86.40").parentElement).toHaveTextContent("$86.40 to complete");
    const bar = screen.getByRole("progressbar", { name: "Charizard ex / Pidgeot completion" });
    expect(bar).toHaveAttribute("aria-valuenow", "85");
    expect(bar.firstElementChild).toHaveClass("bg-accent");
    expect(screen.queryByText(/no market price/)).not.toBeInTheDocument();
  });

  it("says Complete with a gain bar when nothing is missing", () => {
    render(<DeckSummaryPanel deck={deck({ tier: null, archetype: null })} gap={gap({ owned: 60, missing: 0, missingCost: 0 })} />);
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.queryByText(/to complete/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Tier/)).not.toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(bar.firstElementChild).toHaveClass("bg-gain");
  });

  it("uses the muted bar when nothing is owned and notes unpriced missing copies", () => {
    render(<DeckSummaryPanel deck={deck()} gap={gap({ owned: 0, missing: 60, missingCost: 12, unpricedMissing: 3 })} />);
    // bg-hairline-strong, not bg-hairline: against the bg-hairline-soft track the plain hairline
    // was 1.06:1 — an invisible bar on every 0%-owned deck.
    expect(screen.getByRole("progressbar").firstElementChild).toHaveClass("bg-hairline-strong");
    expect(screen.getByText("3 missing copies have no market price")).toBeInTheDocument();
  });

  it("uses the singular for one unpriced copy", () => {
    render(<DeckSummaryPanel deck={deck()} gap={gap({ unpricedMissing: 1 })} />);
    expect(screen.getByText("1 missing copy has no market price")).toBeInTheDocument();
  });
});
