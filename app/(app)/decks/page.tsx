import { SectionHeading, EmptyState } from "@/components/ui";

export const metadata = { title: "Decks — Hitstreak" };

export default function DecksPage() {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeading as="h1" title="Decks" />
      <EmptyState
        title="Coming in Phase 4"
        body="Meta decks, gap analysis, and the deck builder land after price history and alerts."
      />
    </div>
  );
}
