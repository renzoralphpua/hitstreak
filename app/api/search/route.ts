// Type-ahead for the command palette and the add-item dialog. Session-checked (results are public
// catalog data, but the endpoint is ours alone) and never cached: `private, no-store`.
//
// Returns three things because the palette shows three groups: cards you own, cards you do not, and
// the sets and decks worth jumping to. Ownership is resolved here in one query for the whole page
// rather than per row — it only decides which group a hit lands in.
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { searchCards, searchJumpTargets } from "@/lib/catalog";
import { getOwnedCounts } from "@/lib/collections";

const MAX_QUERY = 100;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  // A query longer than this can only be junk (the LIKE would scan for nothing); cap it.
  const q = (params.get("q") ?? "").slice(0, MAX_QUERY);
  const game = params.get("game") ?? "";
  // The dialogs want cards only; the palette asks for the rest with ?jump=1.
  const wantJump = params.get("jump") === "1";

  const hits = await searchCards(q, { gameSlug: game || undefined });
  const [owned, jump] = await Promise.all([
    getOwnedCounts(session.user.id, hits.map((h) => h.cardId)),
    wantJump ? searchJumpTargets(session.user.id, q) : Promise.resolve([]),
  ]);

  return NextResponse.json(
    { hits: hits.map((h) => ({ ...h, owned: owned.get(h.cardId) ?? 0 })), jump },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
