// Type-ahead card search for the add-item dialog. Session-checked (results are public catalog
// data, but the endpoint is ours alone) and never cached: `private, no-store`.
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { searchCards } from "@/lib/catalog";

const MAX_QUERY = 100;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  // A query longer than this can only be junk (the LIKE would scan for nothing); cap it.
  const q = (params.get("q") ?? "").slice(0, MAX_QUERY);
  const game = params.get("game") ?? "";
  const hits = await searchCards(q, { gameSlug: game || undefined });

  return NextResponse.json({ hits }, { headers: { "Cache-Control": "private, no-store" } });
}
